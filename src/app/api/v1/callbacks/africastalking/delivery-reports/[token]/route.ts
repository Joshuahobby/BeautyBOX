import { NextResponse, type NextRequest } from "next/server";
import { withApi } from "@/server/http/api";
import { constantTimeEqual, sha256Hex } from "@/server/crypto";
import { serverEnv } from "@/server/env";
import { logEvent } from "@/server/log";
import { DomainError, notFound } from "@/modules/shared/errors";
import { parseDeliveryReport, recordDeliveryReport } from "@/modules/notifications/delivery-reports";

// Africa's Talking SMS delivery reports (DR-048), set in their dashboard under SMS > SMS
// Callback URLs > Delivery Reports as https://<origin>/api/v1/callbacks/africastalking/delivery-reports/<AFRICASTALKING_CALLBACK_TOKEN>.
// Africa's Talking does not sign callbacks, so the secret address is the authentication; a wrong
// or missing token, or reports switched off, all answer 404. Reports only update what staff see
// about a message (see delivery-reports.ts). Exempt from browser CSRF checks and the pre-launch
// wall like every provider callback.
export const dynamic = "force-dynamic";

const MAX_REPORT_BYTES = 8 * 1024;

export const POST = withApi<{ token: string }>(async (request: NextRequest, { token }) => {
  const env = serverEnv();
  const expected = env.SMS_PROVIDER === "africastalking" ? env.AFRICASTALKING_CALLBACK_TOKEN : undefined;
  // Digests have equal length, so the comparison takes the same time whatever was sent.
  if (!expected || !constantTimeEqual(sha256Hex(token), sha256Hex(expected))) throw notFound();

  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    throw new DomainError("VALIDATION_ERROR", "Send the delivery report as a form.", { httpStatus: 400 });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_REPORT_BYTES) throw new DomainError("VALIDATION_ERROR", "Delivery report too large.", { httpStatus: 413 });
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > MAX_REPORT_BYTES) throw new DomainError("VALIDATION_ERROR", "Delivery report too large.", { httpStatus: 413 });

  const report = parseDeliveryReport(new URLSearchParams(raw.toString("utf8")));
  if (!report) throw new DomainError("VALIDATION_ERROR", "Not a delivery report.", { httpStatus: 400 });
  const outcome = await recordDeliveryReport(report);
  // Accepted either way, so Africa's Talking does not keep resending a report we cannot use.
  logEvent("info", "sms_delivery_report", { outcome, status: report.status });
  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
});
