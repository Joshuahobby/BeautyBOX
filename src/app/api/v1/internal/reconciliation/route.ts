import type { NextRequest } from "next/server";
import { jsonResponse, withApi } from "@/server/http/api";
import { serverEnv } from "@/server/env";
import { constantTimeEqual } from "@/server/crypto";
import { DomainError } from "@/modules/shared/errors";
import { reconciliationSweep } from "@/modules/ops/reconciliation";

// Reconciliation sweep for schedulers and monitors (I13): read-only integrity checks with
// counts and record ids only. Same rotated internal secret as the job trigger.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !constantTimeEqual(token, serverEnv().WORKER_SECRET)) throw new DomainError("UNAUTHORIZED", "Not authorized.");
  return jsonResponse(await reconciliationSweep(), { requestId: ctx.requestId });
});
