import "server-only";
import { transaction, type Tx } from "@/server/db";
import type { Order } from "@/generated/prisma/client";
import { now } from "@/modules/shared/clock";
import { DomainError, notFound } from "@/modules/shared/errors";
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from "@/modules/idempotency/idempotency";
import { audit, type Actor } from "@/modules/audit/audit";
import { applyLotDelta } from "@/modules/inventory/stock";
import { lockReservationForAttempt, releaseReservation } from "@/modules/inventory/reservations";
import { openRefundCase } from "@/modules/refunds/cases";
import { createNotificationIntent } from "@/modules/notifications/intents";
import { can } from "@/modules/staff/capabilities";
import { resolveOperations } from "@/modules/operations/operations";
import type { StaffIdentity } from "@/modules/staff/identity";

// Guarded order commands (A02/A03, DEL-08, POL-01, contract OrderCommand). Every command
// locks the order row, checks expectedVersion, re-validates payment/allocation/cancellation
// state and changes stock atomically with the state. CANCEL and HAND_OVER lock the SAME
// order row, so exactly one wins; the loser gets VERSION_CONFLICT (T09).

export type OrderCommand =
  | { action: "START_PREPARATION"; expectedVersion: number; reason: string }
  | { action: "ASSIGN_RIDER"; expectedVersion: number; reason: string; riderReference: string }
  | { action: "HAND_OVER"; expectedVersion: number; reason: string; riderReference: string; occurredAt: string }
  | { action: "CONFIRM_DELIVERY"; expectedVersion: number; reason: string; occurredAt: string; confirmationReference: string }
  | { action: "RECORD_FAILED_ATTEMPT"; expectedVersion: number; reason: string; occurredAt: string; custody: "RIDER" | "BEAUTYBOX" | "RECIPIENT" }
  | { action: "CANCEL"; expectedVersion: number; reason: string }
  | { action: "HOLD"; expectedVersion: number; reason: string };

const notAllowed = (message: string) => new DomainError("ACTION_NOT_ALLOWED", message);

function occurred(iso: string): Date {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) throw new DomainError("VALIDATION_ERROR", "Enter a valid date and time.", { fieldErrors: [{ field: "occurredAt", message: "Invalid time." }] });
  if (at.getTime() > now().getTime() + 5 * 60 * 1000) throw new DomainError("VALIDATION_ERROR", "The time cannot be in the future.", { fieldErrors: [{ field: "occurredAt", message: "Future time." }] });
  return at;
}

async function lockOrder(tx: Tx, orderId: string): Promise<Order> {
  const ref = await tx.order.findUnique({ where: { id: orderId }, select: { checkoutId: true } });
  if (!ref) throw notFound();
  // Same lock order as payments: checkout -> order.
  await tx.$queryRaw`SELECT id FROM commerce.checkouts WHERE id = ${ref.checkoutId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM commerce.orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  return tx.order.findUniqueOrThrow({ where: { id: orderId } });
}

async function currentAllocations(tx: Tx, order: Order) {
  return tx.allocation.findMany({
    where: { orderLine: { orderId: order.id, snapshotRevision: order.snapshotRevision } },
    orderBy: { lotId: "asc" },
  });
}

/**
 * After a failed attempt with the goods back at BeautyBOX, the order is redelivered:
 * assign a rider again and record a new handover (no stock moves; it already left).
 */
async function awaitingRedelivery(tx: Tx, order: Order): Promise<boolean> {
  if (order.state !== "DISPATCHED") return false;
  const fulfillment = await tx.fulfillment.findUnique({ where: { orderId: order.id } });
  if (!fulfillment || (fulfillment.state !== "FAILED_ATTEMPT" && fulfillment.state !== "ASSIGNED")) return false;
  const last = await tx.deliveryAttempt.findFirst({ where: { orderId: order.id }, orderBy: { occurredAt: "desc" } });
  return last?.outcome === "FAILED" && last.goodsCustody === "BEAUTYBOX";
}

async function assertDispatchable(tx: Tx, order: Order) {
  // Only a verified-paid, fully allocated, uncancelled order may move toward the rider.
  // Callers check the order state they need; this re-checks money and stock.
  if (order.state === "CANCELLED") throw notAllowed("This order was cancelled. It cannot be prepared or handed over.");
  if (order.paymentState !== "PAID" && order.paymentState !== "PARTIALLY_REFUNDED") throw notAllowed("Payment is not verified for this order.");
  const lines = await tx.orderLine.findMany({ where: { orderId: order.id, snapshotRevision: order.snapshotRevision } });
  const allocations = await currentAllocations(tx, order);
  for (const line of lines) {
    const allocated = allocations.filter((a) => a.orderLineId === line.id && a.state === "COMMITTED").reduce((n, a) => n + a.quantity, 0);
    if (allocated !== line.quantity) throw notAllowed("Stock is not fully allocated to this order.");
  }
}

export const capabilityFor = (action: OrderCommand["action"]): "orders.cancel" | "fulfillment.write" => (action === "CANCEL" ? "orders.cancel" : "fulfillment.write");

export async function applyOrderCommand(
  staff: StaffIdentity,
  orderId: string,
  command: OrderCommand,
  idempotencyKey: string,
  requestId: string | null,
): Promise<void> {
  if (!can(staff.role, capabilityFor(command.action))) throw new DomainError("FORBIDDEN", "Your role does not allow this action.");
  const reason = command.reason.trim();
  if (!reason) throw new DomainError("VALIDATION_ERROR", "Give a reason.", { fieldErrors: [{ field: "reason", message: "Required." }] });
  const actor: Actor = { type: "STAFF", id: staff.staffId };

  await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:order-command:${orderId}`, key: idempotencyKey, requestHash: requestHash("orderCommand", command) });
    if (claim.kind === "REPLAY") return;
    const order = await lockOrder(tx, orderId);
    if (order.version !== command.expectedVersion) {
      throw new DomainError("VERSION_CONFLICT", "This order changed since you opened it. Reload to see its current state.");
    }
    const at = now();
    const before = { state: order.state, paymentState: order.paymentState };
    let after: Record<string, unknown> = {};

    switch (command.action) {
      case "START_PREPARATION": {
        // Also resumes an order from hold once payment is verified and stock is fully
        // allocated again; a stock or payment hold stays blocked by assertDispatchable.
        if (order.state !== "PAID" && order.state !== "ON_HOLD") throw notAllowed("Only a paid order that is not yet in preparation can start preparation.");
        await assertDispatchable(tx, order);
        await tx.order.update({ where: { id: order.id }, data: { state: "PREPARING", holdReason: null, version: { increment: 1 } } });
        await tx.fulfillment.upsert({ where: { orderId: order.id }, create: { orderId: order.id }, update: {} });
        after = { state: "PREPARING", resumedFromHold: order.state === "ON_HOLD" ? order.holdReason : undefined };
        break;
      }
      case "ASSIGN_RIDER": {
        if (order.state !== "PREPARING" && !(await awaitingRedelivery(tx, order))) throw notAllowed("Assign a rider once the order is in preparation.");
        const rider = command.riderReference.trim();
        if (!rider) throw new DomainError("VALIDATION_ERROR", "Enter the rider reference.");
        await tx.fulfillment.update({ where: { orderId: order.id }, data: { state: "ASSIGNED", riderReference: rider, assignedAt: at, version: { increment: 1 } } });
        await tx.order.update({ where: { id: order.id }, data: { version: { increment: 1 } } });
        after = { riderReference: rider };
        break;
      }
      case "HAND_OVER": {
        const fulfillment = await tx.fulfillment.findUnique({ where: { orderId: order.id } });
        const rider = command.riderReference.trim();
        if (order.state === "DISPATCHED" && (await awaitingRedelivery(tx, order))) {
          // Redelivery after a failed attempt: same goods, already shipped from stock.
          if (order.paymentState !== "PAID" && order.paymentState !== "PARTIALLY_REFUNDED") throw notAllowed("Payment is not verified for this order (or it was refunded).");
          if (!fulfillment || fulfillment.state !== "ASSIGNED" || fulfillment.riderReference !== rider) throw notAllowed("Hand over only to the assigned rider.");
          await tx.fulfillment.update({ where: { orderId: order.id }, data: { state: "COLLECTED", collectedAt: occurred(command.occurredAt), version: { increment: 1 } } });
          await tx.order.update({ where: { id: order.id }, data: { version: { increment: 1 } } });
          after = { redelivery: true, riderReference: rider };
          break;
        }
        if (order.state !== "PREPARING") throw notAllowed("Only an order in preparation can be handed to a rider.");
        await assertDispatchable(tx, order);
        if (!fulfillment || fulfillment.state !== "ASSIGNED" || fulfillment.riderReference !== rider) {
          throw notAllowed("Hand over only to the assigned rider.");
        }
        const collectedAt = occurred(command.occurredAt);
        // Shipment reduces on-hand and committed together (CAT-06).
        for (const allocation of await currentAllocations(tx, order)) {
          if (allocation.state !== "COMMITTED") continue;
          await applyLotDelta(tx, allocation.lotId, { onHand: -allocation.quantity, reserved: 0, committed: -allocation.quantity }, {
            type: "SHIP",
            reason: `Handed to rider ${rider}`,
            actor,
            orderId: order.id,
          });
          await tx.allocation.update({ where: { id: allocation.id }, data: { state: "SHIPPED" } });
        }
        await tx.fulfillment.update({ where: { orderId: order.id }, data: { state: "COLLECTED", collectedAt, version: { increment: 1 } } });
        await tx.order.update({ where: { id: order.id }, data: { state: "DISPATCHED", version: { increment: 1 } } });
        await createNotificationIntent(tx, { orderId: order.id, event: "ORDER_DISPATCHED" });
        // Handover won: a customer cancellation request still waiting is declined and
        // support follows up under the returns policy (decisions addendum 5).
        const declined = await resolveOperations(tx, { orderId: order.id, type: "CANCELLATION_REQUEST" }, "FAILED", "The order had already been handed to our delivery partner. Support will contact you.");
        after = { state: "DISPATCHED", riderReference: rider, ...(declined ? { cancellationRequestDeclined: true } : {}) };
        break;
      }
      case "CONFIRM_DELIVERY": {
        if (order.state !== "DISPATCHED") throw notAllowed("Only a dispatched order can be marked delivered.");
        if (await awaitingRedelivery(tx, order)) {
          throw notAllowed("The goods are back at BeautyBOX after a failed attempt. Assign a rider and record a new handover first.");
        }
        const deliveredAt = occurred(command.occurredAt);
        await tx.deliveryAttempt.create({ data: { orderId: order.id, outcome: "DELIVERED", reason: command.confirmationReference.trim() || null, recordedByStaffId: staff.staffId, occurredAt: deliveredAt } });
        await tx.fulfillment.update({ where: { orderId: order.id }, data: { state: "DELIVERED", deliveredAt, version: { increment: 1 } } });
        await tx.order.update({ where: { id: order.id }, data: { state: "DELIVERED", version: { increment: 1 } } });
        after = { state: "DELIVERED" };
        break;
      }
      case "RECORD_FAILED_ATTEMPT": {
        if (order.state !== "DISPATCHED") throw notAllowed("Record failed attempts for dispatched orders.");
        const when = occurred(command.occurredAt);
        const attempt = await tx.deliveryAttempt.create({ data: { orderId: order.id, outcome: "FAILED", reason, goodsCustody: command.custody, recordedByStaffId: staff.staffId, occurredAt: when } });
        await tx.fulfillment.update({ where: { orderId: order.id }, data: { state: "FAILED_ATTEMPT", version: { increment: 1 } } });
        await tx.order.update({ where: { id: order.id }, data: { version: { increment: 1 } } });
        await createNotificationIntent(tx, { orderId: order.id, event: "DELIVERY_PROBLEM", intentKey: attempt.id });
        after = { delivery: "FAILED_ATTEMPT", custody: command.custody };
        break;
      }
      case "CANCEL": {
        after = await cancelOrder(tx, order, reason, actor);
        break;
      }
      case "HOLD": {
        if (order.state !== "PAID" && order.state !== "PREPARING") throw notAllowed("Only paid orders that are not yet dispatched can be put on hold.");
        await tx.order.update({ where: { id: order.id }, data: { state: "ON_HOLD", holdReason: "MANUAL", version: { increment: 1 } } });
        after = { state: "ON_HOLD", holdReason: "MANUAL" };
        break;
      }
    }

    await audit(tx, { actor, entityType: "order", entityId: order.id, action: `ORDER_${command.action}`, before, after, reason, requestId });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "order", resourceId: order.id, responseStatus: 200 });
  });
}

/**
 * Pre-handover cancellation (POL-01). Releases reserved or committed stock (not on-hand),
 * keeps every receipt, and opens a refund case for collected money. An unresolved payment
 * keeps reconciling; a later success follows the refund path (AT11). After handover the
 * order cannot be cancelled here: support reviews the case.
 */
export async function cancelOrder(tx: Tx, order: Order, reason: string, actor: Actor): Promise<Record<string, unknown>> {
  if (order.state === "CANCELLED") throw notAllowed("This order is already cancelled.");
  if (order.state === "DISPATCHED" || order.state === "DELIVERED") {
    throw notAllowed("This order has already been handed to the rider. Handle it through the returns process.");
  }
  // Active reservation of an unresolved attempt: release it (the payment keeps reconciling).
  const attempts = await tx.paymentAttempt.findMany({ where: { orderId: order.id } });
  for (const attempt of attempts) {
    await tx.$queryRaw`SELECT id FROM commerce.payment_attempts WHERE id = ${attempt.id}::uuid FOR UPDATE`;
    const reservation = await lockReservationForAttempt(tx, attempt.id);
    if (reservation?.state === "ACTIVE") {
      await releaseReservation(tx, reservation.id, order.id, "RELEASED", "Order cancelled before payment was verified", actor);
    }
  }
  // Committed stock of a paid order returns to availability.
  for (const allocation of await currentAllocations(tx, order)) {
    if (allocation.state !== "COMMITTED") continue;
    await applyLotDelta(tx, allocation.lotId, { onHand: 0, reserved: 0, committed: -allocation.quantity }, {
      type: "UNCOMMIT",
      reason: "Order cancelled before handover",
      actor,
      orderId: order.id,
    });
    await tx.allocation.update({ where: { id: allocation.id }, data: { state: "RELEASED" } });
    // Nothing was sold: the consignment amount for these units is no longer owed. A
    // settled obligation cannot exist here (settlement requires a handover).
    await tx.supplierObligation.updateMany({
      where: { allocationId: allocation.id, settlementState: { in: ["OPEN", "UNVALUED"] } },
      data: { settlementState: "VOID", version: { increment: 1 } },
    });
  }
  const applied = await tx.paymentReceipt.findMany({ where: { orderId: order.id, disposition: "APPLIED" } });
  for (const receipt of applied) {
    await openRefundCase(tx, { orderId: order.id, receiptId: receipt.id, source: "CANCELLATION", reason: `Cancelled before dispatch: ${reason}` });
  }
  const unresolved = attempts.some((a) => a.state === "CREATED" || a.state === "PENDING");
  await tx.order.update({
    where: { id: order.id },
    data: { state: "CANCELLED", cancelledAt: now(), cancellationReason: reason, holdReason: null, version: { increment: 1 } },
  });
  // The customer cannot pay this checkout any more; their cart stays editable.
  await tx.checkout.updateMany({ where: { id: order.checkoutId, state: { in: ["EDITING", "REVIEWED", "PAYMENT_PENDING"] } }, data: { state: "EXPIRED" } });
  await tx.fulfillment.updateMany({ where: { orderId: order.id }, data: { state: "UNASSIGNED", riderReference: null } });
  await resolveOperations(tx, { orderId: order.id, type: "CANCELLATION_REQUEST" }, "SUCCEEDED", unresolved ? "Your order is cancelled. We are still checking the payment and will help with any refund needed." : applied.length > 0 ? "Your order is cancelled. A refund of your payment is being arranged." : "Your order is cancelled.");
  return { state: "CANCELLED", refundCases: applied.length, paymentStillReconciling: unresolved };
}
