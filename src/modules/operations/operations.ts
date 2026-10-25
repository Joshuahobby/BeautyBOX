import "server-only";
import type { Operation, OperationType, Prisma } from "@/generated/prisma/client";
import { db, transaction, type Tx } from "@/server/db";
import { now } from "@/modules/shared/clock";
import { DomainError, notFound } from "@/modules/shared/errors";
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from "@/modules/idempotency/idempotency";
import { audit } from "@/modules/audit/audit";
import { canViewOrder, viewerKey, type OrderViewer } from "@/modules/orders/access";

// Durable, pollable operations (contract Operation). Customer: cancellation requests.
// Staff: payment/refund reconcile and private-link reissue. An operation records that
// something was asked for and how it ended; it is never the authority for money or
// order state (those live on the attempt, refund and order rows).

export type OperationView = {
  id: string;
  state: "PENDING" | "SUCCEEDED" | "FAILED";
  statusUrl: string;
  // Additions (CC-12): what was asked for and a plain-language outcome.
  type: OperationType;
  outcome: string | null;
};

const CUSTOMER_TYPES: ReadonlySet<OperationType> = new Set(["CANCELLATION_REQUEST"]);

export function operationView(op: Operation): OperationView {
  return {
    id: op.id,
    state: op.state,
    statusUrl: CUSTOMER_TYPES.has(op.type) ? `/api/v1/operations/${op.id}` : `/api/v1/staff/operations/${op.id}`,
    type: op.type,
    outcome: op.outcome,
  };
}

/** Resolve every pending operation matching `where` (idempotent: resolved ones are left alone). */
export async function resolveOperations(
  client: Tx | ReturnType<typeof db>,
  where: Prisma.OperationWhereInput,
  state: "SUCCEEDED" | "FAILED",
  outcome: string,
): Promise<number> {
  const result = await client.operation.updateMany({ where: { ...where, state: "PENDING" }, data: { state, outcome, resolvedAt: now() } });
  return result.count;
}

/**
 * Creates a pending operation, or returns the one already pending for the same order
 * (cancellation) or subject (reconcile). The partial unique indexes back this up.
 */
export async function openOperation(
  tx: Tx,
  input: { orderId: string; type: OperationType; reason: string; subjectId?: string | null; requestedByStaffId?: string | null; caseReference?: string | null },
): Promise<Operation> {
  const existing = await tx.operation.findFirst({
    where:
      input.type === "CANCELLATION_REQUEST"
        ? { orderId: input.orderId, type: input.type, state: "PENDING" }
        : input.subjectId
          ? { type: input.type, subjectId: input.subjectId, state: "PENDING" }
          : { id: "00000000-0000-0000-0000-000000000000" },
  });
  if (existing) return existing;
  return tx.operation.create({
    data: {
      orderId: input.orderId,
      type: input.type,
      reason: input.reason,
      subjectId: input.subjectId ?? null,
      requestedByStaffId: input.requestedByStaffId ?? null,
      caseReference: input.caseReference ?? null,
    },
  });
}

const viewerScope = (viewer: OrderViewer) => viewerKey(viewer);

/**
 * Customer cancellation REQUEST (contract requestCancellation, decisions addendum 5).
 * It is not a cancellation decision: staff decide with the guarded CANCEL command, and a
 * handover that wins the race resolves the request as declined. After handover the
 * request is refused with a pointer to support (returns policy), never silently applied.
 */
export async function requestCancellation(
  viewer: OrderViewer,
  orderId: string,
  input: { expectedVersion: number; reason: string },
  idempotencyKey: string,
  requestId: string | null,
): Promise<OperationView> {
  if (!(await canViewOrder(orderId, viewer))) throw notFound();
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("VALIDATION_ERROR", "Tell us why you want to cancel.", { fieldErrors: [{ field: "reason", message: "Required." }] });
  const operationId = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, {
      scope: `${viewerScope(viewer)}:cancel-request:${orderId}`,
      key: idempotencyKey,
      requestHash: requestHash("requestCancellation", input),
    });
    if (claim.kind === "REPLAY") return claim.resourceId;
    const ref = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { checkoutId: true } });
    await tx.$queryRaw`SELECT id FROM commerce.checkouts WHERE id = ${ref.checkoutId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM commerce.orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.version !== input.expectedVersion) {
      throw new DomainError("VERSION_CONFLICT", "This order was updated. Review its current status before asking to cancel.");
    }
    if (order.state === "CANCELLED") throw new DomainError("ACTION_NOT_ALLOWED", "This order is already cancelled.");
    if (order.state === "DISPATCHED" || order.state === "DELIVERED") {
      throw new DomainError("ACTION_NOT_ALLOWED", "This order has already been handed to our delivery partner. Contact support for help.");
    }
    const op = await openOperation(tx, { orderId, type: "CANCELLATION_REQUEST", reason });
    await audit(tx, {
      actor: { type: "CUSTOMER", id: null },
      entityType: "order",
      entityId: orderId,
      action: "CANCELLATION_REQUESTED",
      after: { operationId: op.id },
      reason,
      requestId,
    });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "operation", resourceId: op.id, responseStatus: 202 });
    return op.id;
  });
  return operationView(await db().operation.findUniqueOrThrow({ where: { id: operationId } }));
}

/** Guest/order-session read of a customer operation; anything else is "not found". */
export async function getGuestOperation(viewer: OrderViewer, operationId: string): Promise<OperationView> {
  const op = await db().operation.findUnique({ where: { id: operationId } });
  if (!op || !CUSTOMER_TYPES.has(op.type) || !(await canViewOrder(op.orderId, viewer))) throw notFound();
  return operationView(op);
}

export async function getStaffOperation(operationId: string): Promise<OperationView> {
  const op = await db().operation.findUnique({ where: { id: operationId } });
  if (!op) throw notFound();
  return operationView(op);
}

export async function pendingCancellationRequest(orderId: string) {
  return db().operation.findFirst({ where: { orderId, type: "CANCELLATION_REQUEST", state: "PENDING" } });
}
