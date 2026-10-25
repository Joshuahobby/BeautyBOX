import "server-only";
import { randomUUID } from "node:crypto";
import type { JobType } from "@/generated/prisma/client";
import { now } from "@/modules/shared/clock";
import { claimDueJobs, settleJob, type ClaimedJob, type JobOutcome } from "./outbox";
import {
  handlePaymentCheck,
  handlePaymentInitiate,
  handleProviderEventApply,
  handleReservationExpiry,
} from "@/modules/payments/handlers";
import { handleNotificationSend } from "@/modules/notifications/handler";
import { handleRefundCheck, handleRefundSubmit } from "@/modules/refunds/refunds";
import { handleMediaPublicSync } from "@/modules/media/publication";
import { logEvent } from "@/server/log";

// Bounded worker: claims a batch of due jobs, runs each handler outside any lock, and
// settles the outcome under lease ownership. Triggered by the scheduler (Supabase
// Cron -> POST /api/v1/internal/jobs/run), by the local `npm run worker` loop, and
// opportunistically right after a request records a new intent.

type Handler = (job: ClaimedJob) => Promise<JobOutcome>;

const HANDLERS: Partial<Record<JobType, Handler>> = {
  PAYMENT_INITIATE: handlePaymentInitiate,
  PAYMENT_CHECK: handlePaymentCheck,
  PROVIDER_EVENT_APPLY: handleProviderEventApply,
  RESERVATION_EXPIRY: handleReservationExpiry,
  NOTIFICATION_SEND: handleNotificationSend,
  REFUND_SUBMIT: handleRefundSubmit,
  REFUND_CHECK: handleRefundCheck,
  MEDIA_PUBLIC_SYNC: handleMediaPublicSync,
};

/** Contract WorkerResult: claimed / completed / retryDue / needsReview. */
export type WorkerResult = { claimed: number; completed: number; retryDue: number; needsReview: number };

// Jobs about unresolved money never retire on an attempt counter: an unresolved deposit
// or refund must keep being reconciled, and an approved refund must keep trying to reach
// the provider (it may be waiting behind another refund for the same deposit), at a
// capped cadence, until resolved.
const NEVER_EXHAUST: ReadonlySet<JobType> = new Set(["PAYMENT_CHECK", "REFUND_CHECK", "REFUND_SUBMIT"]);

export const LEASE_SECONDS = 60;

export function registerJobHandler(type: JobType, handler: Handler) {
  HANDLERS[type] = handler;
}

export async function runDueJobs(input: { batchSize: number; maxRuntimeMs: number; onlyJobId?: string }): Promise<WorkerResult> {
  const started = now().getTime();
  const owner = `worker-${randomUUID()}`;
  const result: WorkerResult = { claimed: 0, completed: 0, retryDue: 0, needsReview: 0 };
  let lostLease = 0;
  while (now().getTime() - started < input.maxRuntimeMs) {
    const remaining = input.batchSize - result.claimed;
    if (remaining <= 0) break;
    const jobs = await claimDueJobs({ batchSize: remaining, leaseSeconds: LEASE_SECONDS, owner, onlyJobId: input.onlyJobId });
    if (jobs.length === 0) break;
    result.claimed += jobs.length;
    for (const job of jobs) {
      const outcome = await runOne(job);
      const settled = await settleJob(job, outcome, NEVER_EXHAUST.has(job.type) ? Number.MAX_SAFE_INTEGER : 50);
      if (!settled) lostLease++;
      else if (outcome.kind === "DONE") result.completed++;
      else if (outcome.kind === "RETRY") result.retryDue++;
      else result.needsReview++;
    }
    if (input.onlyJobId) break;
  }
  if (lostLease > 0) logEvent("warn", "job_lease_lost", { count: lostLease });
  return result;
}

async function runOne(job: ClaimedJob): Promise<JobOutcome> {
  const handler = HANDLERS[job.type];
  if (!handler) return { kind: "NEEDS_REVIEW", errorCode: "NO_HANDLER" };
  try {
    return await handler(job);
  } catch (error) {
    // Redacted: the job id and error class only; never payloads or provider bodies.
    logEvent("error", "job_failed", { jobId: job.id, type: job.type, error: error instanceof Error ? error.name : "unknown" });
    return { kind: "RETRY", afterSeconds: Math.min(300, 5 * 2 ** Math.min(6, job.attempts)), errorCode: "HANDLER_ERROR" };
  }
}
