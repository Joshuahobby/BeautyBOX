import "server-only";
import type { Tx } from "@/server/db";
import { db } from "@/server/db";
import type { JobType, OutboxJob } from "@/generated/prisma/client";
import { addSeconds, now } from "@/modules/shared/clock";

// Durable outbox (ADR-09). A job is written in the same transaction as the business
// change that needs an external effect. Workers claim due jobs with a lease using
// FOR UPDATE SKIP LOCKED, commit the claim, call the provider outside any lock, and
// record the outcome in a separate transaction guarded by lease ownership. An expired
// lease means "investigate and retry the same intent", never "create a new payment".

export async function enqueueJob(
  tx: Tx,
  input: { type: JobType; uniqueIntentKey: string; entityId: string; dueAt?: Date; payload?: Record<string, unknown> },
): Promise<void> {
  // Unique intent key makes enqueueing idempotent: the same effect is recorded once.
  await tx.$executeRaw`
    INSERT INTO commerce.outbox_jobs (unique_intent_key, type, entity_id, payload, due_at, state)
    VALUES (${input.uniqueIntentKey}, ${input.type}::commerce."JobType", ${input.entityId}::uuid,
            ${JSON.stringify(input.payload ?? {})}::jsonb, ${input.dueAt ?? now()}, 'READY'::commerce."JobState")
    ON CONFLICT (unique_intent_key) DO NOTHING`;
}

/** Re-arm an existing recurring job (e.g. a payment status check) for a new due time. */
export async function rescheduleJob(tx: Tx, uniqueIntentKey: string, dueAt: Date): Promise<void> {
  await tx.$executeRaw`
    UPDATE commerce.outbox_jobs
       SET state = 'RETRY_DUE'::commerce."JobState", due_at = ${dueAt}, lease_until = NULL, lease_owner = NULL,
           updated_at = ${now()}
     WHERE unique_intent_key = ${uniqueIntentKey} AND state IN ('SUCCEEDED', 'RETRY_DUE', 'READY', 'NEEDS_REVIEW')`;
}

export type ClaimedJob = Pick<OutboxJob, "id" | "type" | "entityId" | "payload" | "attempts" | "uniqueIntentKey"> & {
  leaseOwner: string;
};

export async function claimDueJobs(input: {
  batchSize: number;
  leaseSeconds: number;
  owner: string;
  onlyJobId?: string;
}): Promise<ClaimedJob[]> {
  const at = now();
  const leaseUntil = addSeconds(at, input.leaseSeconds);
  const rows = await db().$queryRaw<
    { id: string; type: JobType; entity_id: string; payload: unknown; attempts: number; unique_intent_key: string }[]
  >`
    UPDATE commerce.outbox_jobs AS j
       SET state = 'LEASED'::commerce."JobState", lease_until = ${leaseUntil}, lease_owner = ${input.owner},
           attempts = j.attempts + 1, updated_at = ${at}
     WHERE j.id IN (
       SELECT id FROM commerce.outbox_jobs
        WHERE ((state IN ('READY', 'RETRY_DUE') AND due_at <= ${at})
           OR (state = 'LEASED' AND lease_until < ${at}))
          AND (${input.onlyJobId ?? null}::uuid IS NULL OR id = ${input.onlyJobId ?? null}::uuid)
        ORDER BY due_at
        LIMIT ${input.batchSize}
        FOR UPDATE SKIP LOCKED)
    RETURNING j.id, j.type, j.entity_id, j.payload, j.attempts, j.unique_intent_key`;
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    entityId: r.entity_id,
    payload: r.payload as OutboxJob["payload"],
    attempts: r.attempts,
    uniqueIntentKey: r.unique_intent_key,
    leaseOwner: input.owner,
  }));
}

export type JobOutcome =
  | { kind: "DONE" }
  | { kind: "RETRY"; afterSeconds: number; errorCode?: string }
  | { kind: "NEEDS_REVIEW"; errorCode: string };

/** Record an outcome only if this worker still owns the lease. */
export async function settleJob(job: ClaimedJob, outcome: JobOutcome, maxAttempts = 50): Promise<boolean> {
  const at = now();
  if (outcome.kind === "DONE") {
    const n = await db().$executeRaw`
      UPDATE commerce.outbox_jobs
         SET state = 'SUCCEEDED'::commerce."JobState", completed_at = ${at}, lease_until = NULL, updated_at = ${at}
       WHERE id = ${job.id}::uuid AND lease_owner = ${job.leaseOwner} AND state = 'LEASED'`;
    return n === 1;
  }
  const exhausted = outcome.kind === "NEEDS_REVIEW" || job.attempts >= maxAttempts;
  const due = outcome.kind === "RETRY" ? addSeconds(at, outcome.afterSeconds) : at;
  const code = outcome.kind === "NEEDS_REVIEW" ? outcome.errorCode : (outcome.errorCode ?? null);
  const n = await db().$executeRaw`
    UPDATE commerce.outbox_jobs
       SET state = ${exhausted ? "NEEDS_REVIEW" : "RETRY_DUE"}::commerce."JobState",
           due_at = ${due}, lease_until = NULL, lease_owner = NULL,
           last_error_code = ${code}, last_error_at = ${code ? at : null}, updated_at = ${at}
     WHERE id = ${job.id}::uuid AND lease_owner = ${job.leaseOwner} AND state = 'LEASED'`;
  return n === 1;
}

/** Exponential backoff with jitter, bounded. */
export function backoffSeconds(attempt: number, baseSeconds = 5, capSeconds = 600): number {
  const exp = Math.min(capSeconds, baseSeconds * 2 ** Math.max(0, attempt - 1));
  return Math.max(1, Math.round(exp * (0.75 + Math.random() * 0.5)));
}
