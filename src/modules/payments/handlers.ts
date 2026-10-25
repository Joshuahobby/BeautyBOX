import "server-only";
import { db, transaction } from "@/server/db";
import { decryptField, encryptField, sha256Hex } from "@/server/crypto";
import { paymentAdapter } from "@/adapters/registry";
import type { CallbackRequest, DepositStatus } from "@/adapters/payments/types";
import { now, addSeconds } from "@/modules/shared/clock";
import { toMsisdn } from "@/modules/shared/phone";
import { DomainError } from "@/modules/shared/errors";
import { audit } from "@/modules/audit/audit";
import { backoffSeconds, enqueueJob, rescheduleJob, type ClaimedJob, type JobOutcome } from "@/modules/jobs/outbox";
import { applyVerifiedFailure, applyVerifiedSuccess, releaseReservationStillUnresolved } from "./outcomes";
import { rateLimit } from "@/server/http/rate-limit";
import { PAYMENT_CHECK_KEY } from "./start-payment";
import { resolveOperations } from "@/modules/operations/operations";

export const REFUND_CHECK_KEY = (providerRefundId: string) => `refund-check:${providerRefundId}`;

// Durable job handlers for deposits. Every provider call happens here, outside any
// database lock, always with the deposit id persisted before the first send. After
// any uncertainty the existing deposit is looked up before anything is resent (T04,
// T17); a new deposit id is never created to work around a lost response.

/** Status polling cadence: quick while the customer is likely watching, then backing off. */
export function nextCheckDelaySeconds(checkCount: number): number {
  if (checkCount < 6) return 5;
  if (checkCount < 14) return 15;
  if (checkCount < 24) return 60;
  return Math.min(600, 60 * 2 ** Math.min(4, checkCount - 24));
}

async function loadAttempt(attemptId: string) {
  return db().paymentAttempt.findUnique({
    where: { id: attemptId },
    include: { order: { select: { reference: true } }, reservation: { select: { state: true, expiresAt: true } } },
  });
}

async function markAccepted(attemptId: string, providerStatus: string) {
  const at = now();
  await db().paymentAttempt.updateMany({
    where: { id: attemptId, state: "CREATED" },
    data: { state: "PENDING", initiationAcceptedAt: at, providerStatus, verificationFlag: null, nextCheckAt: addSeconds(at, 5) },
  });
}

/** Apply an authoritative status lookup. Returns true when the attempt is now resolved. */
export async function applyDepositStatus(attemptId: string, status: DepositStatus): Promise<boolean> {
  switch (status.kind) {
    case "SUCCEEDED":
      await applyVerifiedSuccess(attemptId, {
        amountRwf: status.amountRwf,
        currency: status.currency,
        providerTransactionId: status.providerTransactionId,
        providerStatus: status.providerStatus,
        evidenceRef: status.evidence.ref,
      });
      return true;
    case "FAILED":
      await applyVerifiedFailure(attemptId, { failureCode: status.failureCode, providerStatus: status.providerStatus });
      return true;
    case "PENDING": {
      const at = now();
      await db().paymentAttempt.updateMany({
        where: { id: attemptId, state: { in: ["CREATED", "PENDING"] } },
        data: { state: "PENDING", providerStatus: status.providerStatus, checkedAt: at, checkCount: { increment: 1 } },
      });
      return false;
    }
    default:
      return false;
  }
}

export async function handlePaymentInitiate(job: ClaimedJob): Promise<JobOutcome> {
  const attempt = await loadAttempt(job.entityId);
  if (!attempt) return { kind: "NEEDS_REVIEW", errorCode: "ATTEMPT_MISSING" };
  if (attempt.state !== "CREATED") return { kind: "DONE" };
  const adapter = paymentAdapter();

  // A previous claim may have reached the provider before its response was lost.
  if (job.attempts > 1 || attempt.verificationFlag === "UNKNOWN") {
    const status = await adapter.getDeposit(attempt.providerDepositId);
    if (status.kind === "UNKNOWN") return { kind: "RETRY", afterSeconds: backoffSeconds(job.attempts), errorCode: "LOOKUP_UNKNOWN" };
    if (status.kind !== "NOT_FOUND") {
      await markAccepted(attempt.id, status.kind === "PENDING" ? status.providerStatus : "FOUND");
      await applyDepositStatus(attempt.id, status);
      return { kind: "DONE" };
    }
  }

  // Do not prompt a wallet after the customer's reservation lapsed (including when the
  // expiry job itself is backlogged): stop and let finance resolve the never-initiated
  // attempt (status checks keep running).
  if (attempt.reservation && (attempt.reservation.state !== "ACTIVE" || attempt.reservation.expiresAt <= now())) {
    if (job.attempts === 1) {
      // This is the job's first claim, so no earlier claim can have called the provider:
      // no deposit can exist and the attempt is definitively not collected (not a timer
      // guessing an unknown outcome). The customer can start again (DR-032).
      await applyVerifiedFailure(attempt.id, { failureCode: "NOT_INITIATED_RESERVATION_EXPIRED", providerStatus: "NOT_SENT" });
      return { kind: "DONE" };
    }
    // A send may have reached the provider (an earlier claim): finance reviews it while
    // status checks continue.
    await db().paymentAttempt.updateMany({ where: { id: attempt.id, state: "CREATED" }, data: { verificationFlag: "NEEDS_REVIEW" } });
    return { kind: "NEEDS_REVIEW", errorCode: "NOT_INITIATED_BEFORE_EXPIRY" };
  }

  const result = await adapter.initiateDeposit({
    depositId: attempt.providerDepositId,
    amountRwf: Number(attempt.amountRwf),
    method: attempt.method,
    payerMsisdn: toMsisdn(decryptField(attempt.payerPhoneEncrypted)),
    customerMessage: "BeautyBOX order",
    clientReference: attempt.order.reference,
  });
  switch (result.kind) {
    case "ACCEPTED":
    case "DUPLICATE":
      await markAccepted(attempt.id, result.providerStatus);
      await transaction(async (tx) => rescheduleJob(tx, PAYMENT_CHECK_KEY(attempt.providerDepositId), addSeconds(now(), 5)));
      return { kind: "DONE" };
    case "REJECTED":
      // Definitive refusal at initiation: no collection can exist for this deposit id.
      await applyVerifiedFailure(attempt.id, { failureCode: result.failureCode, providerStatus: "REJECTED" });
      return { kind: "DONE" };
    case "UNKNOWN":
      await db().paymentAttempt.updateMany({ where: { id: attempt.id, state: "CREATED" }, data: { verificationFlag: "UNKNOWN" } });
      return { kind: "RETRY", afterSeconds: backoffSeconds(job.attempts, 3, 120), errorCode: "INITIATION_UNKNOWN" };
  }
}

/** An unresolved attempt this old is surfaced to finance (checks continue regardless). */
export const UNRESOLVED_REVIEW_AFTER_SECONDS = 2 * 60 * 60;

export async function handlePaymentCheck(job: ClaimedJob): Promise<JobOutcome> {
  const outcome = await checkPayment(job);
  // A staff "check now" request is answered once the provider has actually answered
  // (including "no such deposit"); only a failed lookup leaves it pending.
  if (!(outcome.kind === "RETRY" && outcome.errorCode === "LOOKUP_UNKNOWN")) {
    const attempt = await db().paymentAttempt.findUnique({ where: { id: job.entityId } });
    if (attempt) {
      const notFound = outcome.kind === "RETRY" && outcome.errorCode === "DEPOSIT_NOT_FOUND";
      await resolveOperations(db(), { type: "PAYMENT_RECONCILE", subjectId: attempt.id }, "SUCCEEDED", reconcileOutcome(attempt.state, notFound));
    }
  }
  return outcome;
}

export function reconcileOutcome(state: string, providerHasNoRecord = false): string {
  if (providerHasNoRecord && (state === "CREATED" || state === "PENDING")) {
    return "The provider has no record of this payment. If it was never started, no money was collected; checks continue in case it appears.";
  }
  switch (state) {
    case "SUCCEEDED":
      return "The provider confirmed this payment.";
    case "FAILED":
      return "The provider confirmed this payment did not complete.";
    default:
      return "The provider still reports this payment as pending. Checks continue automatically.";
  }
}

async function checkPayment(job: ClaimedJob): Promise<JobOutcome> {
  const attempt = await loadAttempt(job.entityId);
  if (!attempt) return { kind: "NEEDS_REVIEW", errorCode: "ATTEMPT_MISSING" };
  if (attempt.state === "SUCCEEDED" || attempt.state === "FAILED") return { kind: "DONE" };
  const at = now();
  const longUnresolved = at.getTime() - attempt.createdAt.getTime() > UNRESOLVED_REVIEW_AFTER_SECONDS * 1000;
  const status = await paymentAdapter().getDeposit(attempt.providerDepositId);
  const delay = nextCheckDelaySeconds(attempt.checkCount);

  if (status.kind === "UNKNOWN" || status.kind === "NOT_FOUND") {
    // Back off and persist the next check time, so status-page polls cannot pull the
    // check forward while the provider lookup is failing. A recent attempt (the customer
    // may be watching) keeps a short cadence; only older ones back off exponentially.
    const young = at.getTime() - attempt.createdAt.getTime() < 30 * 60 * 1000;
    const lookupDelay = young ? Math.max(delay, 15) : Math.max(delay, backoffSeconds(job.attempts, 5, 600));
    const needsReview = longUnresolved || (status.kind === "NOT_FOUND" && attempt.initiationAcceptedAt !== null);
    await db().paymentAttempt.updateMany({
      where: { id: attempt.id, state: { in: ["CREATED", "PENDING"] } },
      data: { nextCheckAt: addSeconds(at, lookupDelay), checkedAt: at, ...(needsReview ? { verificationFlag: "NEEDS_REVIEW" as const } : {}) },
    });
    return { kind: "RETRY", afterSeconds: lookupDelay, errorCode: status.kind === "UNKNOWN" ? "LOOKUP_UNKNOWN" : "DEPOSIT_NOT_FOUND" };
  }
  if (attempt.state === "CREATED") await markAccepted(attempt.id, "FOUND");
  const resolved = await applyDepositStatus(attempt.id, status);
  if (resolved) return { kind: "DONE" };
  await db().paymentAttempt.updateMany({
    where: { id: attempt.id, state: { in: ["CREATED", "PENDING"] } },
    data: { nextCheckAt: addSeconds(at, delay), ...(longUnresolved ? { verificationFlag: "NEEDS_REVIEW" as const } : {}) },
  });
  return { kind: "RETRY", afterSeconds: delay };
}

export async function handleReservationExpiry(job: ClaimedJob): Promise<JobOutcome> {
  const reservation = await db().reservation.findUnique({ where: { id: job.entityId }, include: { attempt: true } });
  if (!reservation || reservation.state !== "ACTIVE") return { kind: "DONE" };
  const wait = Math.ceil((reservation.expiresAt.getTime() - now().getTime()) / 1000);
  if (wait > 0) return { kind: "RETRY", afterSeconds: wait };
  const attempt = reservation.attempt;
  if (attempt.state === "CREATED" || attempt.state === "PENDING") {
    // Reconcile first: a timeout is not evidence of failure (FSD section 8).
    const status = await paymentAdapter().getDeposit(attempt.providerDepositId);
    if (status.kind === "SUCCEEDED" || status.kind === "FAILED") {
      if (attempt.state === "CREATED") await markAccepted(attempt.id, "FOUND");
      await applyDepositStatus(attempt.id, status);
      return { kind: "DONE" };
    }
  }
  await releaseReservationStillUnresolved(attempt.id);
  return { kind: "DONE" };
}

// ---------------------------------------------------------------- provider callbacks

export type CallbackIngestResult = { accepted: boolean; status: number };

/**
 * Durably records a provider callback before acknowledging it. A callback is only a
 * trigger: the applied outcome always comes from the authoritative status lookup, so
 * a forged, stale or replayed body cannot mark anything paid (T05, T06).
 */
export async function ingestProviderCallback(request: CallbackRequest, meta: { clientAddress: string } = { clientAddress: "unknown" }): Promise<CallbackIngestResult> {
  const adapter = paymentAdapter();
  const verification = await adapter.verifyCallback(request);
  const at = now();
  if (!verification.verified) {
    // Unverified events live in their own hash namespace (body + presented signature), so a
    // forged copy of a body can never pre-empt or "deduplicate away" the genuine signed event.
    // Bound what an unauthenticated sender can make us store (genuine signed callbacks are never throttled).
    await rateLimit("callbackUnverified", meta.clientAddress);
    const presented = request.headers.get("signature") ?? request.headers.get("x-devsim-signature") ?? "";
    const invalidHash = sha256Hex(`unverified:${verification.eventHash}:${presented}`);
    await db().$executeRaw`
      INSERT INTO commerce.provider_events (event_hash, provider, kind, reference, signature_status, received_at, outcome)
      VALUES (${invalidHash}, ${adapter.provider}::commerce."PaymentProvider", 'UNVERIFIED', 'unverified',
              ${verification.signature}::commerce."SignatureStatus", ${at}, ${verification.reason.slice(0, 120)})
      ON CONFLICT (event_hash) DO NOTHING`;
    throw new DomainError("UNAUTHORIZED", "Callback signature could not be verified.");
  }

  await transaction(async (tx) => {
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO commerce.provider_events (event_hash, provider, kind, reference, claimed_status, signature_status, encrypted_evidence, received_at)
      VALUES (${verification.eventHash}, ${adapter.provider}::commerce."PaymentProvider", ${verification.kind},
              ${verification.reference}, ${verification.claimedStatus}, ${verification.signature}::commerce."SignatureStatus",
              ${encryptField(request.rawBody.toString("utf8"))}, ${at})
      ON CONFLICT (event_hash) DO NOTHING
      RETURNING id`;
    if (inserted.length === 0) return; // exact replay of an already recorded event
    const eventId = inserted[0]!.id;
    if (verification.kind === "DEPOSIT") {
      const attempt = await tx.paymentAttempt.findUnique({ where: { providerDepositId: verification.reference } });
      if (!attempt) {
        await tx.providerEvent.update({ where: { id: eventId }, data: { outcome: "UNKNOWN_REFERENCE" } });
        await audit(tx, { actor: { type: "PROVIDER", id: null }, entityType: "provider_event", entityId: eventId, action: "CALLBACK_UNKNOWN_REFERENCE" });
        return;
      }
      await enqueueJob(tx, { type: "PROVIDER_EVENT_APPLY", uniqueIntentKey: `provider-event:${eventId}`, entityId: eventId });
      await rescheduleJob(tx, PAYMENT_CHECK_KEY(attempt.providerDepositId), at);
    } else {
      // Refund callback: also only a trigger for the authoritative refund status lookup.
      const found = await tx.refund.findUnique({ where: { providerRefundId: verification.reference }, select: { id: true, receiptId: true } });
      if (!found) {
        await tx.providerEvent.update({ where: { id: eventId }, data: { outcome: "UNKNOWN_REFERENCE" } });
        await audit(tx, { actor: { type: "PROVIDER", id: null }, entityType: "provider_event", entityId: eventId, action: "CALLBACK_UNKNOWN_REFERENCE" });
        return;
      }
      // Lock receipt -> refund (the order every refund writer uses) and decide on the state as
      // it is now: a status check recording FAILED either committed first (seen here) or waits
      // for this event and flags it itself (finishRefund), so the contradiction is never lost.
      await tx.$queryRaw`SELECT id FROM commerce.payment_receipts WHERE id = ${found.receiptId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM commerce.refunds WHERE id = ${found.id}::uuid FOR UPDATE`;
      const refund = await tx.refund.findUniqueOrThrow({ where: { id: found.id } });
      if (refund.state === "FAILED" && verification.claimedStatus === "COMPLETED") {
        // A signed "completed" for a refund recorded as failed contradicts our record. Money
        // may have left: flag it for finance (DR-042) rather than closing it silently.
        if (refund.verificationFlag !== "NEEDS_REVIEW") await tx.refund.update({ where: { id: refund.id }, data: { verificationFlag: "NEEDS_REVIEW", version: { increment: 1 } } });
        await tx.providerEvent.update({ where: { id: eventId }, data: { appliedAt: at, outcome: "CONTRADICTS_FAILED_REFUND" } });
        await audit(tx, { actor: { type: "PROVIDER", id: null }, entityType: "refund", entityId: refund.id, action: "REFUND_CALLBACK_CONTRADICTS_FAILURE", after: { claimedStatus: "COMPLETED" } });
        return;
      }
      // Make sure the check job exists before re-arming it, so a callback is never dropped.
      await enqueueJob(tx, { type: "REFUND_CHECK", uniqueIntentKey: REFUND_CHECK_KEY(verification.reference), entityId: refund.id, dueAt: at });
      await rescheduleJob(tx, REFUND_CHECK_KEY(verification.reference), at);
      await tx.providerEvent.update({ where: { id: eventId }, data: { appliedAt: at, outcome: "REFUND_CHECK_SCHEDULED" } });
    }
  });
  return { accepted: true, status: 200 };
}

export async function handleProviderEventApply(job: ClaimedJob): Promise<JobOutcome> {
  const event = await db().providerEvent.findUnique({ where: { id: job.entityId } });
  if (!event || event.appliedAt) return { kind: "DONE" };
  if (event.kind !== "DEPOSIT") return { kind: "DONE" }; // refund callbacks re-arm the refund status check at ingest
  const attempt = await db().paymentAttempt.findUnique({ where: { providerDepositId: event.reference } });
  if (!attempt) return { kind: "DONE" };
  const status = await paymentAdapter().getDeposit(event.reference);
  if (status.kind === "UNKNOWN") return { kind: "RETRY", afterSeconds: backoffSeconds(job.attempts), errorCode: "LOOKUP_UNKNOWN" };
  if (attempt.state === "CREATED" && status.kind !== "NOT_FOUND") await markAccepted(attempt.id, "FOUND");
  await applyDepositStatus(attempt.id, status);
  await db().providerEvent.update({ where: { id: event.id }, data: { appliedAt: now(), outcome: `CHECKED_${status.kind}` } });
  return { kind: "DONE" };
}
