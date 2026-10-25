import type { NextRequest } from "next/server";
import { jsonResponse, readJson, withApi } from "@/server/http/api";
import { runJobsInput } from "@/server/http/schemas";
import { serverEnv } from "@/server/env";
import { constantTimeEqual } from "@/server/crypto";
import { DomainError } from "@/modules/shared/errors";
import { runDueJobs } from "@/modules/jobs/worker";
import { runHousekeepingSafely } from "@/modules/ops/housekeeping";

// Authenticated scheduler trigger (Supabase Cron -> pg_net). The body only bounds the
// batch; it cannot name job code, URLs or entities.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !constantTimeEqual(token, serverEnv().WORKER_SECRET)) {
    throw new DomainError("UNAUTHORIZED", "Not authorized.");
  }
  const body = await readJson(request, runJobsInput);
  // First, so slow or failing jobs cannot hold it up: launch-list retention and spent rate-limit counters.
  await runHousekeepingSafely();
  const result = await runDueJobs({ batchSize: body.batchSize, maxRuntimeMs: body.maxRuntimeSeconds * 1000 });
  return jsonResponse(result, { requestId: ctx.requestId });
});
