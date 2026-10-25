import type { NextRequest } from "next/server";
import { jsonResponse, withApi } from "@/server/http/api";
import { serverEnv } from "@/server/env";
import { constantTimeEqual } from "@/server/crypto";
import { DomainError } from "@/modules/shared/errors";
import { opsSummary } from "@/modules/ops/summary";

// Monitoring probe (I13): counts and ages only, no personal or payment data. Uses the
// same rotated internal secret as the job trigger. A monitor alerts when `alerts` is
// non-empty, and treats any non-200 (including database failure) as an outage.
export const dynamic = "force-dynamic";

export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !constantTimeEqual(token, serverEnv().WORKER_SECRET)) throw new DomainError("UNAUTHORIZED", "Not authorized.");
  return jsonResponse(await opsSummary(), { requestId: ctx.requestId });
});
