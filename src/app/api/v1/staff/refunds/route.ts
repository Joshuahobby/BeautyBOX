import type { NextRequest } from "next/server";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { refundRequestInput, uuidPageQuery } from "@/server/http/staff-schemas";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { listRefunds, requestRefund } from "@/modules/refunds/refunds";
import { DomainError } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  await staffFrom(request, "payments.read", ctx.requestId);
  const parsed = uuidPageQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Check the page parameters.");
  return jsonResponse(await listRefunds({ limit: parsed.data.limit, cursor: parsed.data.cursor ?? null }), { requestId: ctx.requestId });
});

// Contract requestRefund: records intent only; approval reserves budget separately.
export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  const staff = await staffFrom(request, "refunds.request", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, refundRequestInput);
  return jsonResponse(await requestRefund(staff, body, key, ctx.requestId), { status: 201, requestId: ctx.requestId });
});
