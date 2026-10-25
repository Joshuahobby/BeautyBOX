import "server-only";
import type { Tx } from "@/server/db";
import { now } from "@/modules/shared/clock";
import type { Actor } from "@/modules/audit/audit";
import { applyLotDelta, lockAndPlanTakes, type LotTake } from "./stock";
import type { StockScope } from "./eligibility";

// Reservation lifecycle. Each transition consumes or releases quantities exactly once
// because it runs only after re-reading the reservation state under a row lock.

export async function lockReservationForAttempt(tx: Tx, attemptId: string) {
  const rows = await tx.$queryRaw<{ id: string; state: string; order_id: string }[]>`
    SELECT id, state::text, order_id FROM commerce.reservations
     WHERE payment_attempt_id = ${attemptId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

/** ACTIVE -> COMMITTED: reserved units become committed units on the same lots. */
export async function commitReservation(tx: Tx, reservationId: string, orderId: string, actor: Actor): Promise<void> {
  const lines = await tx.reservationLine.findMany({ where: { reservationId }, orderBy: { lotId: "asc" } });
  for (const line of lines) {
    await applyLotDelta(tx, line.lotId, { onHand: 0, reserved: -line.quantity, committed: line.quantity }, {
      type: "COMMIT",
      reason: "Verified payment commits reserved stock",
      actor,
      orderId,
      reservationId,
    });
  }
  await createAllocations(
    tx,
    lines.map((l) => ({ orderLineId: l.orderLineId, lotId: l.lotId, quantity: l.quantity, variantId: "" })),
  );
  await tx.reservation.update({ where: { id: reservationId }, data: { state: "COMMITTED", updatedAt: now() } });
}

/** ACTIVE -> RELEASED | EXPIRED: reserved units return to availability. */
export async function releaseReservation(
  tx: Tx,
  reservationId: string,
  orderId: string,
  to: "RELEASED" | "EXPIRED",
  reason: string,
  actor: Actor,
): Promise<void> {
  const lines = await tx.reservationLine.findMany({ where: { reservationId }, orderBy: { lotId: "asc" } });
  for (const line of lines) {
    await applyLotDelta(tx, line.lotId, { onHand: 0, reserved: -line.quantity, committed: 0 }, {
      type: "RELEASE",
      reason,
      actor,
      orderId,
      reservationId,
    });
  }
  await tx.reservation.update({ where: { id: reservationId }, data: { state: to, updatedAt: now() } });
}

/**
 * Late verified payment after the reservation was released (T08): attempt complete
 * reallocation of the whole basket directly into committed stock. Returns false (and
 * changes nothing) when any line cannot be fully satisfied.
 */
export async function reallocateAndCommit(
  tx: Tx,
  input: { orderId: string; lines: { orderLineId: string; variantId: string; quantity: number }[]; scope: StockScope; actor: Actor },
): Promise<boolean> {
  const takes = await lockAndPlanTakes(tx, input.lines, input.scope);
  if (!takes) return false;
  for (const take of takes) {
    await applyLotDelta(tx, take.lotId, { onHand: 0, reserved: 0, committed: take.quantity }, {
      type: "COMMIT",
      reason: "Late verified payment reallocated stock",
      actor: input.actor,
      orderId: input.orderId,
    });
  }
  await createAllocations(tx, takes);
  return true;
}

/** Allocations record the actual lots (and so the supplier) used for each order line. */
async function createAllocations(tx: Tx, takes: LotTake[]): Promise<void> {
  for (const take of takes) {
    const allocation = await tx.allocation.create({
      data: { orderLineId: take.orderLineId, lotId: take.lotId, quantity: take.quantity, state: "COMMITTED" },
    });
    const lot = await tx.inventoryLot.findUniqueOrThrow({ where: { id: take.lotId } });
    if (lot.supplierId) {
      // Supplier obligations follow a verified cost basis; without one the obligation is
      // recorded as an unvalued finance exception rather than a guessed amount.
      const valued = lot.costBasisRwf !== null;
      await tx.supplierObligation.create({
        data: {
          allocationId: allocation.id,
          supplierId: lot.supplierId,
          basis: valued ? "AGREEMENT_COST" : "UNVALUED",
          amountRwf: valued ? lot.costBasisRwf! * BigInt(take.quantity) : null,
          settlementState: valued ? "OPEN" : "UNVALUED",
        },
      });
    }
  }
}
