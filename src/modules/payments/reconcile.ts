import "server-only";
import { db, transaction } from "@/server/db";
import { now } from "@/modules/shared/clock";
import { DomainError, notFound } from "@/modules/shared/errors";
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from "@/modules/idempotency/idempotency";
import { audit } from "@/modules/audit/audit";
import { rescheduleJob } from "@/modules/jobs/outbox";
import { can } from "@/modules/staff/capabilities";
import type { StaffIdentity } from "@/modules/staff/identity";
import { openOperation, operationView, resolveOperations, type OperationView } from "@/modules/operations/operations";
import { PAYMENT_CHECK_KEY } from "./start-payment";
import { reconcileOutcome } from "./handlers";

// Finance tools for deposits (A04, contract reconcilePayment / listPaymentExceptions).
// "Check now" only re-runs the authoritative lookup of the EXISTING deposit id; it never
// creates a new collection. An unresolved deposit keeps being checked regardless.

/** Unresolved this long without a flag is still shown to finance as delayed. */
export const DELAYED_AFTER_SECONDS = 10 * 60;

export async function reconcilePayment(staff: StaffIdentity, attemptId: string, reason: string, idempotencyKey: string, requestId: string | null): Promise<OperationView> {
  if (!can(staff.role, "payments.reconcile")) throw new DomainError("FORBIDDEN", "Your role does not allow reconciliation.");
  if (!reason.trim()) throw new DomainError("VALIDATION_ERROR", "Give a reason.", { fieldErrors: [{ field: "reason", message: "Required." }] });
  const operationId = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:payment-reconcile:${attemptId}`, key: idempotencyKey, requestHash: requestHash("reconcilePayment", { reason }) });
    if (claim.kind === "REPLAY") return claim.resourceId;
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM commerce.payment_attempts WHERE id = ${attemptId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound();
    const attempt = await tx.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const op = await openOperation(tx, { orderId: attempt.orderId, type: "PAYMENT_RECONCILE", subjectId: attempt.id, reason: reason.trim(), requestedByStaffId: staff.staffId });
    if (attempt.state === "CREATED" || attempt.state === "PENDING") {
      await rescheduleJob(tx, PAYMENT_CHECK_KEY(attempt.providerDepositId), now());
    } else {
      await resolveOperations(tx, { id: op.id }, "SUCCEEDED", reconcileOutcome(attempt.state));
    }
    await audit(tx, { actor: { type: "STAFF", id: staff.staffId }, entityType: "payment_attempt", entityId: attempt.id, action: "PAYMENT_RECONCILE_REQUESTED", reason: reason.trim(), requestId });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "operation", resourceId: op.id, responseStatus: 202 });
    return op.id;
  });
  return operationView(await db().operation.findUniqueOrThrow({ where: { id: operationId } }));
}

export type PaymentExceptionView = {
  attemptId: string;
  orderId: string;
  code: string;
  ageSeconds: number;
  nextCheckAt: string | null;
  lastCheckedAt: string | null;
  // Additions (CC-13): what finance needs to act without opening every order.
  orderReference: string;
  attemptState: string;
  amountRwf: number;
};

/**
 * Attempts finance must look at: anything flagged (mismatch, needs review, superseded)
 * plus unresolved deposits older than DELAYED_AFTER_SECONDS. Oldest first.
 */
function exceptionWhere() {
  const delayedBefore = new Date(now().getTime() - DELAYED_AFTER_SECONDS * 1000);
  return { OR: [{ verificationFlag: { not: null } }, { state: { in: ["CREATED" as const, "PENDING" as const] }, createdAt: { lt: delayedBefore } }] };
}

export async function countPaymentExceptions(): Promise<number> {
  return db().paymentAttempt.count({ where: exceptionWhere() });
}

export async function listPaymentExceptions(input: { limit?: number; cursor?: string | null }) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const rows = await db().paymentAttempt.findMany({
    where: exceptionWhere(),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: { order: { select: { reference: true } } },
  });
  const at = now().getTime();
  return {
    items: rows.slice(0, limit).map(
      (a): PaymentExceptionView => ({
        attemptId: a.id,
        orderId: a.orderId,
        code: a.verificationFlag ?? "DELAYED_UNRESOLVED",
        ageSeconds: Math.max(0, Math.floor((at - a.createdAt.getTime()) / 1000)),
        nextCheckAt: a.state === "CREATED" || a.state === "PENDING" ? (a.nextCheckAt?.toISOString() ?? null) : null,
        lastCheckedAt: a.checkedAt?.toISOString() ?? null,
        orderReference: a.order.reference,
        attemptState: a.state,
        amountRwf: Number(a.amountRwf),
      }),
    ),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
  };
}
