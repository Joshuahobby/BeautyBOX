import "server-only";
import { randomUUID } from "node:crypto";
import { db, transaction, type Tx } from "@/server/db";
import { paymentAdapter } from "@/adapters/registry";
import { addSeconds, now } from "@/modules/shared/clock";
import { DomainError, notFound } from "@/modules/shared/errors";
import { toRwf } from "@/modules/shared/money";
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from "@/modules/idempotency/idempotency";
import { audit } from "@/modules/audit/audit";
import { backoffSeconds, enqueueJob, rescheduleJob, type ClaimedJob, type JobOutcome } from "@/modules/jobs/outbox";
import { createNotificationIntent } from "@/modules/notifications/intents";
import { can } from "@/modules/staff/capabilities";
import type { StaffIdentity } from "@/modules/staff/identity";
import { closeCaseIfDone, holdsRefundBudget, openRefundCase } from "./cases";
import { REFUND_CHECK_KEY } from "@/modules/payments/handlers";
import { openOperation, operationView, resolveOperations, type OperationView } from "@/modules/operations/operations";

// Refunds (FSD REF-01/02, Data-and-State-Model "Refund transaction", T11/T12).
// - Requests record intent; only ADMIN/FINANCE approve.
// - Approval locks the receipt and reserves budget: approved + queued + submitted +
//   pending + succeeded refunds never exceed the verified collection (also a DB trigger).
// - One provider refund per deposit in flight at a time (partial unique index).
// - The provider refund id is fixed at approval and reused on every retry; an unknown
//   outcome is looked up, never resubmitted as a new refund.
// - A refund flagged NEEDS_REVIEW (the provider's records differ from ours) keeps its amount
//   reserved, even when failed, until finance resolves the review (DR-043).

const RESERVING = ["APPROVED", "QUEUED", "SUBMITTED", "PENDING", "SUCCEEDED"] as const;
const IN_FLIGHT = ["SUBMITTED", "PENDING"] as const;
const REFUND_SUBMIT_KEY = (providerRefundId: string) => `refund-submit:${providerRefundId}`;

/** Receipts whose money belongs to the order (the order's payment state follows them). */
export const ORDER_MONEY_DISPOSITIONS = ["APPLIED", "AFTER_CANCELLATION", "REVIEW"] as const;

export type RefundView = {
  id: string;
  orderId: string;
  receiptId: string;
  amountRwf: number;
  currency: "RWF";
  reason: string;
  version: number;
  state: "REQUESTED" | "APPROVED" | "QUEUED" | "SUBMITTED" | "PENDING" | "SUCCEEDED" | "FAILED" | "REJECTED";
  providerRefundId: string | null;
  // Additions (CC-17): a provider-confirmed amount that differs from the request.
  verificationFlag: "MISMATCH" | "NEEDS_REVIEW" | "UNKNOWN" | null;
  providerAmountRwf: number | null;
};

export type ReceiptView = {
  id: string;
  orderId: string;
  amountRwf: number;
  currency: "RWF";
  verifiedAt: string;
  providerReference: string;
  refundedRwf: number;
  reservedRefundRwf: number;
  remainingRefundableRwf: number;
};

async function refundView(id: string): Promise<RefundView> {
  const r = await db().refund.findUniqueOrThrow({ where: { id }, include: { refundCase: true } });
  return {
    id: r.id,
    orderId: r.refundCase.orderId,
    receiptId: r.receiptId,
    amountRwf: toRwf(r.amountRwf),
    currency: "RWF",
    reason: r.reason,
    version: r.version,
    state: r.state,
    providerRefundId: r.providerRefundId,
    verificationFlag: r.verificationFlag,
    providerAmountRwf: r.providerAmountRwf === null ? null : toRwf(r.providerAmountRwf),
  };
}

export async function receiptBudget(client: Tx | ReturnType<typeof db>, receiptId: string) {
  const receipt = await client.paymentReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  const refunds = await client.refund.findMany({ where: { receiptId } });
  const sum = (rows: typeof refunds) => rows.reduce((n, r) => n + Number(r.amountRwf), 0);
  const collected = Number(receipt.verifiedAmountRwf);
  const refunded = sum(refunds.filter((r) => r.state === "SUCCEEDED"));
  const reserved = sum(refunds.filter((r) => r.state !== "SUCCEEDED" && holdsRefundBudget(r)));
  return { receipt, collected, refunded, reserved, remaining: Math.max(0, collected - refunded - reserved) };
}

export async function receiptView(receiptId: string): Promise<ReceiptView> {
  const b = await receiptBudget(db(), receiptId);
  return {
    id: b.receipt.id,
    orderId: b.receipt.orderId,
    amountRwf: b.collected,
    currency: "RWF",
    verifiedAt: b.receipt.verifiedAt.toISOString(),
    providerReference: b.receipt.providerTransactionId ?? b.receipt.evidenceRef,
    refundedRwf: b.refunded,
    reservedRefundRwf: b.reserved,
    remainingRefundableRwf: b.remaining,
  };
}

export async function requestRefund(
  staff: StaffIdentity,
  input: { orderId: string; receiptId: string; amountRwf: number; reason: string },
  idempotencyKey: string,
  requestId: string | null,
): Promise<RefundView> {
  if (!can(staff.role, "refunds.request")) throw new DomainError("FORBIDDEN", "Your role does not allow refund requests.");
  if (!input.reason.trim()) throw new DomainError("VALIDATION_ERROR", "Give the refund reason.", { fieldErrors: [{ field: "reason", message: "Required." }] });
  const id = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:refund-request`, key: idempotencyKey, requestHash: requestHash("requestRefund", input) });
    if (claim.kind === "REPLAY") return claim.resourceId;
    const receipt = await tx.paymentReceipt.findUnique({ where: { id: input.receiptId } });
    if (!receipt || receipt.orderId !== input.orderId) throw notFound();
    const budget = await receiptBudget(tx, receipt.id);
    if (input.amountRwf < 1 || input.amountRwf > budget.remaining) {
      throw new DomainError("REFUND_LIMIT", `At most ${budget.remaining} RWF can still be refunded from this payment.`);
    }
    const caseId = await openRefundCase(tx, { orderId: input.orderId, receiptId: receipt.id, source: "STAFF_REQUEST", reason: input.reason.trim(), requestedByStaffId: staff.staffId });
    if (!caseId) throw new DomainError("REFUND_LIMIT", "Nothing is left to refund from this payment.");
    const refund = await tx.refund.create({
      data: { caseId, receiptId: receipt.id, amountRwf: BigInt(input.amountRwf), reason: input.reason.trim(), requestedByStaffId: staff.staffId },
    });
    await audit(tx, { actor: { type: "STAFF", id: staff.staffId }, entityType: "refund", entityId: refund.id, action: "REFUND_REQUESTED", after: { amountRwf: input.amountRwf, orderId: input.orderId }, reason: input.reason.trim(), requestId });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "refund", resourceId: refund.id, responseStatus: 201 });
    return refund.id;
  });
  return refundView(id);
}

export async function decideRefund(
  staff: StaffIdentity,
  refundId: string,
  input: { expectedVersion: number; decision: "APPROVE" | "REJECT"; reason: string },
  idempotencyKey: string,
  requestId: string | null,
): Promise<RefundView> {
  if (!can(staff.role, "refunds.approve")) throw new DomainError("FORBIDDEN", "Only finance or an administrator can approve refunds.");
  if (!input.reason.trim()) throw new DomainError("VALIDATION_ERROR", "Give the decision reason.", { fieldErrors: [{ field: "reason", message: "Required." }] });
  await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:refund-decision:${refundId}`, key: idempotencyKey, requestHash: requestHash("decideRefund", input) });
    if (claim.kind === "REPLAY") return;
    const ref = await tx.refund.findUnique({ where: { id: refundId } });
    if (!ref) throw notFound();
    // Lock order: receipt -> refund. The receipt lock serializes every budget decision.
    await tx.$queryRaw`SELECT id FROM commerce.payment_receipts WHERE id = ${ref.receiptId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM commerce.refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    if (refund.version !== input.expectedVersion) throw new DomainError("VERSION_CONFLICT", "This refund changed. Reload before deciding.");
    if (refund.state !== "REQUESTED") throw new DomainError("ACTION_NOT_ALLOWED", "Only a requested refund can be approved or rejected.");
    const at = now();
    if (input.decision === "REJECT") {
      await tx.refund.update({ where: { id: refundId }, data: { state: "REJECTED", version: { increment: 1 } } });
    } else {
      const budget = await receiptBudget(tx, refund.receiptId);
      if (Number(refund.amountRwf) > budget.remaining) {
        throw new DomainError("REFUND_LIMIT", `Only ${budget.remaining} RWF remains refundable from this payment.`);
      }
      const providerRefundId = randomUUID();
      await tx.refund.update({
        where: { id: refundId },
        data: { state: "QUEUED", approvedByStaffId: staff.staffId, approvedAt: at, providerRefundId, version: { increment: 1 } },
      });
      await enqueueJob(tx, { type: "REFUND_SUBMIT", uniqueIntentKey: `refund-submit:${providerRefundId}`, entityId: refundId, dueAt: at });
    }
    await audit(tx, {
      actor: { type: "STAFF", id: staff.staffId },
      entityType: "refund",
      entityId: refundId,
      action: input.decision === "APPROVE" ? "REFUND_APPROVED" : "REFUND_REJECTED",
      after: { amountRwf: Number(refund.amountRwf) },
      reason: input.reason.trim(),
      requestId,
    });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "refund", resourceId: refundId, responseStatus: 200 });
  }).catch((error) => {
    // The DB budget trigger is the last line of defence against an over-approval race.
    if (error instanceof Error && /refund budget exceeded/.test(error.message)) {
      throw new DomainError("REFUND_LIMIT", "This approval would exceed the amount collected.");
    }
    throw error;
  });
  return refundView(refundId);
}

export function refundReconcileOutcome(state: string, detail: { notFound?: boolean; mismatch?: boolean; needsReview?: boolean } = {}): string {
  if (detail.mismatch) return "The provider confirmed this refund for a different amount. Finance must review it with the provider.";
  if (detail.needsReview) return "The provider's records for this refund differ from ours. Finance must check the payment with the provider before refunding again.";
  if (detail.notFound && (state === "SUBMITTED" || state === "PENDING")) {
    return "The provider has no record of this refund yet. Submission is retried with the same refund reference; no second refund is created.";
  }
  switch (state) {
    case "SUCCEEDED":
      return "The provider confirmed this refund.";
    case "FAILED":
      return "The provider confirmed this refund failed. The amount is available to refund again.";
    case "REQUESTED":
      return "This refund is waiting for approval; nothing has been sent to the provider.";
    case "REJECTED":
      return "This refund was rejected; nothing was sent to the provider.";
    case "QUEUED":
    case "APPROVED":
      return "This refund is queued for submission (one refund per payment at a time).";
    default:
      return "The provider still reports this refund as pending. Checks continue automatically.";
  }
}

/**
 * Staff "check now" (contract reconcileRefund): re-arms the status lookup for the SAME
 * provider refund id and returns a pollable operation. It never submits a new refund,
 * however often it is clicked (T12).
 */
export async function reconcileRefund(staff: StaffIdentity, refundId: string, reason: string, idempotencyKey: string, requestId: string | null): Promise<OperationView> {
  if (!can(staff.role, "payments.reconcile")) throw new DomainError("FORBIDDEN", "Your role does not allow reconciliation.");
  if (!reason.trim()) throw new DomainError("VALIDATION_ERROR", "Give a reason.", { fieldErrors: [{ field: "reason", message: "Required." }] });
  const operationId = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:refund-reconcile:${refundId}`, key: idempotencyKey, requestHash: requestHash("reconcileRefund", { reason }) });
    if (claim.kind === "REPLAY") return claim.resourceId;
    const found = await tx.refund.findUnique({ where: { id: refundId }, select: { receiptId: true } });
    if (!found) throw notFound();
    // The global lock order (checkout -> order -> receipt -> refund), so two concurrent "check
    // now" clicks share one pending operation, and the operation insert (which references the
    // order) never waits on an order lock while holding the receipt.
    await lockRefundAggregate(tx, refundId);
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { refundCase: true } });
    const op = await openOperation(tx, { orderId: refund.refundCase.orderId, type: "REFUND_RECONCILE", subjectId: refund.id, reason: reason.trim(), requestedByStaffId: staff.staffId });
    const pid = refund.providerRefundId;
    if (pid && (refund.state === "QUEUED" || refund.state === "SUBMITTED")) {
      // Re-arm the submission for the SAME refund id (it looks the refund up before any resend).
      await enqueueJob(tx, { type: "REFUND_SUBMIT", uniqueIntentKey: REFUND_SUBMIT_KEY(pid), entityId: refund.id });
      await rescheduleJob(tx, REFUND_SUBMIT_KEY(pid), now());
    }
    if (pid && (refund.state === "SUBMITTED" || refund.state === "PENDING")) {
      await enqueueJob(tx, { type: "REFUND_CHECK", uniqueIntentKey: REFUND_CHECK_KEY(pid), entityId: refund.id });
      await rescheduleJob(tx, REFUND_CHECK_KEY(pid), now());
    } else {
      // Nothing is with the provider right now: answer from the refund's own state.
      const flags = { mismatch: refund.verificationFlag === "MISMATCH", needsReview: refund.verificationFlag === "NEEDS_REVIEW" };
      await resolveOperations(tx, { id: op.id }, flags.mismatch || flags.needsReview ? "FAILED" : "SUCCEEDED", refundReconcileOutcome(refund.state, flags));
    }
    await audit(tx, { actor: { type: "STAFF", id: staff.staffId }, entityType: "refund", entityId: refund.id, action: "REFUND_RECONCILE_REQUESTED", reason: reason.trim(), requestId });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "operation", resourceId: op.id, responseStatus: 202 });
    return op.id;
  });
  return operationView(await db().operation.findUniqueOrThrow({ where: { id: operationId } }));
}

/** The case a receipt's money needs when it is owed back in full, or null when it is the order's own payment. */
function owedCaseSource(orderState: string, disposition: string): "CANCELLATION" | "OVERPAYMENT" | "PAYMENT_REVIEW" | null {
  if (disposition === "OVERPAYMENT") return "OVERPAYMENT";
  if (disposition === "REVIEW") return "PAYMENT_REVIEW";
  if (disposition === "AFTER_CANCELLATION" || orderState === "CANCELLED") return "CANCELLATION";
  return null;
}

/**
 * Finance closes a refund's NEEDS_REVIEW flag after checking the payment in the provider's
 * dashboard (contract resolveRefundReview, CC-18, DR-043). Audited, idempotent and versioned.
 * - AS_RECORDED: the provider agrees with the refund's record. For a failed refund: no refund
 *   of this payment was made by any other route, so its amount becomes refundable again. For
 *   one still with the provider or succeeded (flagged because pawaPay was processing a refund
 *   this app did not send): that other refund is a separate one, not a duplicate.
 * - PAID_BY_PROVIDER: a refund recorded as failed was in fact paid out (a later signed
 *   "completed", or the money went back through a refund made outside the app). It is recorded
 *   as succeeded for the amount actually paid back, with the provider reference finance saw.
 */
export async function resolveRefundReview(
  staff: StaffIdentity,
  refundId: string,
  input: { expectedVersion: number; outcome: "AS_RECORDED" | "PAID_BY_PROVIDER"; providerReference?: string | null; paidAmountRwf?: number | null; reason: string },
  idempotencyKey: string,
  requestId: string | null,
): Promise<RefundView> {
  if (!can(staff.role, "refunds.approve")) throw new DomainError("FORBIDDEN", "Only finance or an administrator can resolve a refund review.");
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("VALIDATION_ERROR", "Say what the provider's dashboard shows.", { fieldErrors: [{ field: "reason", message: "Required." }] });
  const providerReference = input.providerReference?.trim() || null;
  if (input.outcome === "PAID_BY_PROVIDER" && !providerReference) {
    throw new DomainError("VALIDATION_ERROR", "Give the provider's reference for the refund that paid the customer.", { fieldErrors: [{ field: "providerReference", message: "Required." }] });
  }
  await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:refund-review:${refundId}`, key: idempotencyKey, requestHash: requestHash("resolveRefundReview", input) });
    if (claim.kind === "REPLAY") return;
    if (!(await tx.refund.findUnique({ where: { id: refundId }, select: { id: true } }))) throw notFound();
    const ref = await lockRefundAggregate(tx, refundId);
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    if (refund.version !== input.expectedVersion) throw new DomainError("VERSION_CONFLICT", "This refund changed. Reload before resolving.");
    if (refund.verificationFlag !== "NEEDS_REVIEW") throw new DomainError("ACTION_NOT_ALLOWED", "This refund is not waiting for a finance review.");
    const amount = Number(refund.amountRwf);
    const paid = input.paidAmountRwf ?? amount;
    if (input.outcome === "PAID_BY_PROVIDER") {
      if (refund.state !== "FAILED") throw new DomainError("ACTION_NOT_ALLOWED", "Only a refund recorded as failed can be recorded as paid; the provider's status settles the others.");
      if (!Number.isSafeInteger(paid) || paid < 1 || paid > amount) {
        throw new DomainError("VALIDATION_ERROR", `The amount paid back must be between 1 and ${amount} RWF.`, { fieldErrors: [{ field: "paidAmountRwf", message: "Out of range." }] });
      }
      // Recorded for what the customer actually got back; the approved amount stays in the audit.
      await tx.refund.update({
        where: { id: refundId },
        data: { state: "SUCCEEDED", amountRwf: BigInt(paid), verifiedAt: now(), verificationFlag: null, failureCode: null, resolutionReference: providerReference, version: { increment: 1 } },
      });
      await applyRefundMoneyLeft(tx, refundId, ref.receiptId, ref.orderId, true);
    } else {
      await tx.refund.update({ where: { id: refundId }, data: { verificationFlag: null, version: { increment: 1 } } });
    }
    // Every open case on this payment may now be settled; and money released for a cancelled
    // order (or an overpayment or review receipt) must have a case again.
    const open = await tx.refundCase.findMany({ where: { receiptId: ref.receiptId, state: "OPEN" }, select: { id: true } });
    for (const id of new Set([ref.caseId, ...open.map((c) => c.id)])) await closeCaseIfDone(tx, id);
    const order = await tx.order.findUniqueOrThrow({ where: { id: ref.orderId }, select: { state: true } });
    const receipt = await tx.paymentReceipt.findUniqueOrThrow({ where: { id: ref.receiptId }, select: { disposition: true } });
    const owed = owedCaseSource(order.state, receipt.disposition);
    if (owed && (await tx.refundCase.count({ where: { receiptId: ref.receiptId, state: "OPEN" } })) === 0) {
      await openRefundCase(tx, { orderId: ref.orderId, receiptId: ref.receiptId, source: owed, reason: "Money still owed after a refund review" });
    }
    await audit(tx, {
      actor: { type: "STAFF", id: staff.staffId },
      entityType: "refund",
      entityId: refundId,
      action: "REFUND_REVIEW_RESOLVED",
      before: { state: refund.state, verificationFlag: refund.verificationFlag, amountRwf: amount, failureCode: refund.failureCode },
      after: { outcome: input.outcome, state: input.outcome === "PAID_BY_PROVIDER" ? "SUCCEEDED" : refund.state, providerReference, ...(input.outcome === "PAID_BY_PROVIDER" ? { amountRwf: paid } : {}) },
      reason,
      requestId,
    });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "refund", resourceId: refundId, responseStatus: 200 });
  }).catch((error) => {
    // The DB budget trigger: another refund already used this amount.
    if (error instanceof Error && /refund budget exceeded/.test(error.message)) {
      throw new DomainError("REFUND_LIMIT", "Recording this refund as paid would exceed the amount collected: another refund already used this amount. Check both with the provider.");
    }
    throw error;
  });
  return refundView(refundId);
}

// ---------------------------------------------------------------- worker handlers

export async function handleRefundSubmit(job: ClaimedJob): Promise<JobOutcome> {
  const refund = await db().refund.findUnique({ where: { id: job.entityId }, include: { receipt: { include: { attempt: true } } } });
  if (!refund || !refund.providerRefundId) return { kind: "NEEDS_REVIEW", errorCode: "REFUND_MISSING" };
  if (refund.state !== "QUEUED" && refund.state !== "SUBMITTED") return { kind: "DONE" };
  const adapter = paymentAdapter();

  if (refund.state === "SUBMITTED") {
    // A previous claim may have reached the provider: look it up before any resend (T12).
    const status = await adapter.getRefund(refund.providerRefundId);
    if (status.kind === "UNKNOWN") return { kind: "RETRY", afterSeconds: backoffSeconds(job.attempts), errorCode: "LOOKUP_UNKNOWN" };
    if (status.kind !== "NOT_FOUND") {
      await markRefundPending(refund.id);
      return { kind: "DONE" };
    }
  } else {
    // Serialize per deposit: wait while another refund for this receipt is with the provider.
    const moved = await transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM commerce.payment_receipts WHERE id = ${refund.receiptId}::uuid FOR UPDATE`;
      const busy = await tx.refund.count({ where: { receiptId: refund.receiptId, state: { in: [...IN_FLIGHT] }, id: { not: refund.id } } });
      if (busy > 0) return false;
      const updated = await tx.refund.updateMany({ where: { id: refund.id, state: "QUEUED" }, data: { state: "SUBMITTED", submittedAt: now(), version: { increment: 1 } } });
      return updated.count === 1;
    });
    // Another refund for this deposit is with the provider. The job never retires on this
    // wait (worker NEVER_EXHAUST), and finishing that refund re-arms this one at once.
    if (!moved) return { kind: "RETRY", afterSeconds: backoffSeconds(job.attempts, 30, 300), errorCode: "REFUND_SERIALIZED_WAIT" };
  }

  const result = await adapter.initiateRefund({ refundId: refund.providerRefundId, depositId: refund.receipt.attempt.providerDepositId, amountRwf: Number(refund.amountRwf) });
  switch (result.kind) {
    case "ACCEPTED":
    case "DUPLICATE":
      await markRefundPending(refund.id);
      return { kind: "DONE" };
    case "REJECTED":
      // A definite refusal: nothing was created for this id, so the refund fails. When the
      // provider's record of the payment disagrees with the request (less left, already
      // refunded, ...) it is flagged and keeps its amount until finance has checked: this app
      // sends a refund only within what it collected and alone for its deposit (DR-043).
      // Applied only if no concurrent run has moved the refund on meanwhile.
      await finishRefund(refund.id, { kind: "FAILED", failureCode: result.failureCode, review: result.conflict === true, onlyIfSubmitted: true });
      return { kind: "DONE" };
    case "UNKNOWN":
      // Stays SUBMITTED (budget reserved); the retry looks the same refund id up first.
      // "Already in progress" while this app has nothing else in flight for the deposit means a
      // refund made outside the app: retried, and flagged so finance checks it is not the same one.
      if (result.refusedForNow === "BUSY") await flagRefundForReview(refund.id, "REFUND_PROVIDER_BUSY_OUTSIDE_APP");
      return { kind: "RETRY", afterSeconds: backoffSeconds(job.attempts, 5, 300), errorCode: result.refusedForNow ? `REFUND_PROVIDER_${result.refusedForNow}` : "REFUND_SUBMIT_UNKNOWN" };
  }
}

/** Locks a refund's receipt, then the refund: the order every refund writer takes (the budget trigger locks the receipt too). */
async function lockReceiptThenRefund(tx: Tx, refundId: string) {
  const { receiptId } = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, select: { receiptId: true } });
  await tx.$queryRaw`SELECT id FROM commerce.payment_receipts WHERE id = ${receiptId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM commerce.refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
}

/**
 * Flags a submitted refund for finance review without changing its state, once per cause: a
 * review finance has closed is not reopened by the next retry meeting the same busy deposit.
 */
async function flagRefundForReview(refundId: string, action: string) {
  await transaction(async (tx) => {
    await lockReceiptThenRefund(tx, refundId);
    if ((await tx.auditEvent.count({ where: { entityType: "refund", entityId: refundId, action } })) > 0) return;
    const flagged = await tx.refund.updateMany({ where: { id: refundId, state: "SUBMITTED", verificationFlag: null }, data: { verificationFlag: "NEEDS_REVIEW", version: { increment: 1 } } });
    if (flagged.count === 1) await audit(tx, { actor: { type: "PROVIDER", id: null }, entityType: "refund", entityId: refundId, action, after: { verificationFlag: "NEEDS_REVIEW" } });
  });
}

async function markRefundPending(refundId: string) {
  await transaction(async (tx) => {
    await lockReceiptThenRefund(tx, refundId);
    const r = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    if (r.state === "SUBMITTED" || r.state === "QUEUED") {
      await tx.refund.update({ where: { id: refundId }, data: { state: "PENDING", version: { increment: 1 } } });
    }
    await enqueueJob(tx, { type: "REFUND_CHECK", uniqueIntentKey: REFUND_CHECK_KEY(r.providerRefundId!), entityId: refundId, dueAt: addSeconds(now(), 5) });
  });
}

export async function handleRefundCheck(job: ClaimedJob): Promise<JobOutcome> {
  const outcome = await checkRefund(job);
  // A staff "check now" request is answered once the provider has answered (including
  // "no such refund"); only a failed lookup leaves it pending.
  if (!(outcome.kind === "RETRY" && outcome.errorCode === "REFUND_UNKNOWN")) {
    const refund = await db().refund.findUnique({ where: { id: job.entityId } });
    if (refund) {
      const mismatch = refund.verificationFlag === "MISMATCH";
      const needsReview = refund.verificationFlag === "NEEDS_REVIEW";
      const notFound = outcome.kind === "RETRY" && outcome.errorCode === "REFUND_NOT_FOUND";
      await resolveOperations(db(), { type: "REFUND_RECONCILE", subjectId: refund.id }, mismatch || needsReview ? "FAILED" : "SUCCEEDED", refundReconcileOutcome(refund.state, { mismatch, needsReview, notFound }));
    }
  }
  return outcome;
}

async function checkRefund(job: ClaimedJob): Promise<JobOutcome> {
  const refund = await db().refund.findUnique({ where: { id: job.entityId } });
  if (!refund || !refund.providerRefundId) return { kind: "NEEDS_REVIEW", errorCode: "REFUND_MISSING" };
  if (refund.state === "SUCCEEDED" || refund.state === "FAILED" || refund.state === "REJECTED") return { kind: "DONE" };
  const status = await paymentAdapter().getRefund(refund.providerRefundId);
  const delay = backoffSeconds(job.attempts, 5, 600);
  if (status.kind === "SUCCEEDED") {
    if (status.amountRwf === null || status.amountRwf !== Number(refund.amountRwf) || status.currency !== "RWF") {
      // The provider completed the refund, but not visibly for the amount and currency we
      // sent (a different, fractional or unreadable amount). Record it as done (so the deposit
      // is no longer blocked), keep the provider's amount as evidence when there is one and
      // flag it for finance; the customer is not told a confirmed amount (RF-11, DR-042).
      await finishRefund(refund.id, { kind: "SUCCEEDED", mismatch: { providerAmountRwf: status.amountRwf } });
      return { kind: "DONE" };
    }
    await finishRefund(refund.id, { kind: "SUCCEEDED" });
    return { kind: "DONE" };
  }
  if (status.kind === "FAILED") {
    await finishRefund(refund.id, { kind: "FAILED", failureCode: status.failureCode });
    return { kind: "DONE" };
  }
  return { kind: "RETRY", afterSeconds: delay, errorCode: status.kind === "PENDING" ? "REFUND_PENDING" : `REFUND_${status.kind}` };
}

/** Locks a refund's checkout, order and receipt in the global lock order (checkout -> order -> ... -> receipt -> refund). */
async function lockRefundAggregate(tx: Tx, refundId: string) {
  const ref = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { refundCase: true } });
  const order = await tx.order.findUniqueOrThrow({ where: { id: ref.refundCase.orderId }, select: { checkoutId: true } });
  await tx.$queryRaw`SELECT id FROM commerce.checkouts WHERE id = ${order.checkoutId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM commerce.orders WHERE id = ${ref.refundCase.orderId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM commerce.payment_receipts WHERE id = ${ref.receiptId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM commerce.refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
  return { orderId: ref.refundCase.orderId, caseId: ref.caseId, receiptId: ref.receiptId };
}

/** Money left for this refund: the order's payment state follows, and the customer is told (unless the amount is in doubt). */
async function applyRefundMoneyLeft(tx: Tx, refundId: string, receiptId: string, orderId: string, announce: boolean) {
  // The order's payment state follows only the money collected for the order; an
  // overpayment refund leaves it unchanged.
  const receipt = await tx.paymentReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  if ((ORDER_MONEY_DISPOSITIONS as readonly string[]).includes(receipt.disposition)) {
    const receipts = await tx.paymentReceipt.findMany({ where: { orderId, disposition: { in: [...ORDER_MONEY_DISPOSITIONS] } } });
    const collected = receipts.reduce((n, r) => n + Number(r.verifiedAmountRwf), 0);
    const refunded = (await tx.refund.findMany({ where: { receiptId: { in: receipts.map((r) => r.id) }, state: "SUCCEEDED" } })).reduce((n, r) => n + Number(r.amountRwf), 0);
    const current = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { paymentState: true } });
    const next = refunded >= collected ? "REFUNDED" : current.paymentState === "EXCEPTION" ? "EXCEPTION" : "PARTIALLY_REFUNDED";
    await tx.order.update({ where: { id: orderId }, data: { paymentState: next, version: { increment: 1 } } });
  }
  if (announce) await createNotificationIntent(tx, { orderId, event: "REFUND_CONFIRMED", intentKey: refundId });
}

/**
 * Terminal refund outcome. Budget is released only on a verified FAILED that is not flagged;
 * SUCCEEDED updates the order's payment state. `onlyIfSubmitted`: an initiation refusal applies
 * only while the refund is still SUBMITTED, never over a concurrent run that moved it on.
 */
async function finishRefund(
  refundId: string,
  outcome: { kind: "SUCCEEDED"; mismatch?: { providerAmountRwf: number | null } } | { kind: "FAILED"; failureCode: string; review?: boolean; onlyIfSubmitted?: boolean },
) {
  await transaction(async (tx) => {
    const ref = await lockRefundAggregate(tx, refundId);
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    if (refund.state === "SUCCEEDED") return;
    if (refund.state === "FAILED") {
      // The provider now says COMPLETED for a refund already recorded as failed (another run
      // won the race): money may have left, so flag it rather than drop the answer.
      if (outcome.kind === "SUCCEEDED" && refund.verificationFlag !== "NEEDS_REVIEW") {
        await tx.refund.update({ where: { id: refundId }, data: { verificationFlag: "NEEDS_REVIEW", version: { increment: 1 } } });
        await audit(tx, { actor: { type: "PROVIDER", id: null }, entityType: "refund", entityId: refundId, action: "REFUND_COMPLETED_AFTER_FAILURE", after: { verificationFlag: "NEEDS_REVIEW" } });
      }
      return;
    }
    if (outcome.kind === "FAILED" && outcome.onlyIfSubmitted && refund.state !== "SUBMITTED") return;
    // A verified callback already claimed this refund COMPLETED: the provider contradicts
    // itself and money may have left. Read under the receipt lock, which the callback path
    // takes too, so whichever commits second sees the other (DR-043).
    const review =
      outcome.kind === "FAILED" &&
      (outcome.review === true ||
        (await tx.providerEvent.count({
          where: { kind: "REFUND", reference: refund.providerRefundId!, claimedStatus: "COMPLETED", signatureStatus: { in: ["VERIFIED", "SIMULATED"] } },
        })) > 0);
    const at = now();
    const mismatch = outcome.kind === "SUCCEEDED" && outcome.mismatch !== undefined;
    const providerAmountRwf = outcome.kind === "SUCCEEDED" ? (outcome.mismatch?.providerAmountRwf ?? null) : null;
    await tx.refund.update({
      where: { id: refundId },
      data:
        outcome.kind === "SUCCEEDED"
          ? {
              state: "SUCCEEDED",
              verifiedAt: at,
              version: { increment: 1 },
              ...(mismatch ? { verificationFlag: "MISMATCH" as const, providerAmountRwf: providerAmountRwf === null ? null : BigInt(providerAmountRwf) } : {}),
            }
          : { state: "FAILED", failureCode: outcome.failureCode, verifiedAt: at, version: { increment: 1 }, ...(review ? { verificationFlag: "NEEDS_REVIEW" as const } : {}) },
    });
    // A refund confirmed for a different amount is not announced with an amount.
    if (outcome.kind === "SUCCEEDED") await applyRefundMoneyLeft(tx, refundId, ref.receiptId, ref.orderId, !mismatch);
    await closeCaseIfDone(tx, ref.caseId);
    // The deposit is free again: submit the next approved refund for it right away.
    const next = await tx.refund.findFirst({ where: { receiptId: ref.receiptId, state: "QUEUED", id: { not: refundId } }, orderBy: { approvedAt: "asc" } });
    if (next?.providerRefundId) {
      await enqueueJob(tx, { type: "REFUND_SUBMIT", uniqueIntentKey: REFUND_SUBMIT_KEY(next.providerRefundId), entityId: next.id, dueAt: at });
      await rescheduleJob(tx, REFUND_SUBMIT_KEY(next.providerRefundId), at);
    }
    await audit(tx, {
      actor: { type: "PROVIDER", id: null },
      entityType: "refund",
      entityId: refundId,
      action: outcome.kind === "FAILED" ? (outcome.review ? "REFUND_REFUSED_BY_PROVIDER" : review ? "REFUND_FAILED_CONTRADICTED" : "REFUND_FAILED") : mismatch ? "REFUND_SUCCEEDED_AMOUNT_MISMATCH" : "REFUND_SUCCEEDED",
      after:
        outcome.kind === "FAILED"
          ? { failureCode: outcome.failureCode, ...(review ? { verificationFlag: "NEEDS_REVIEW" } : {}) }
          : { amountRwf: Number(refund.amountRwf), ...(mismatch ? { providerAmountRwf } : {}) },
    });
  });
}

export async function listRefunds(input: { limit?: number; cursor?: string | null }) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const rows = await db().refund.findMany({ orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: limit + 1, ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}), select: { id: true } });
  const items = [];
  for (const r of rows.slice(0, limit)) items.push(await refundView(r.id));
  return { items, nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
}

export async function listReceipts(input: { limit?: number; cursor?: string | null }) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const rows = await db().paymentReceipt.findMany({ orderBy: [{ verifiedAt: "desc" }, { id: "asc" }], take: limit + 1, ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}), select: { id: true } });
  const items = [];
  for (const r of rows.slice(0, limit)) items.push(await receiptView(r.id));
  return { items, nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
}

export const RESERVING_STATES = RESERVING;
