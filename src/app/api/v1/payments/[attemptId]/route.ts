import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonResponse, withApi } from "@/server/http/api";
import { afterResponse } from "@/server/http/after";
import { viewerFrom } from "@/server/http/session";
import { rateLimit } from "@/server/http/rate-limit";
import { getPaymentAttemptView } from "@/modules/orders/customer-views";
import { viewerKey } from "@/modules/orders/access";
import { runDueJobs } from "@/modules/jobs/worker";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const GET = withApi<{ attemptId: string }>(async (request: NextRequest, { attemptId }, ctx) => {
  if (!z.uuid().safeParse(attemptId).success) throw notFound();
  const viewer = await viewerFrom(request);
  await rateLimit("statusRead", viewerKey(viewer));
  const attempt = await getPaymentAttemptView(attemptId, viewer);
  if (attempt.state === "CREATED" || attempt.state === "PENDING") {
    // Bounded reconciliation nudge; the browser's view never decides the outcome.
    afterResponse(() => runDueJobs({ batchSize: 3, maxRuntimeMs: 8_000 }));
  }
  return jsonResponse(attempt, { requestId: ctx.requestId });
});
