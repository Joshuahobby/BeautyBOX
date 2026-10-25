import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { MovementType } from "@/generated/prisma/client";
import type { Tx } from "@/server/db";
import { now } from "@/modules/shared/clock";
import { DomainError } from "@/modules/shared/errors";
import { sellableLotCondition, type StockScope } from "./eligibility";
import type { Actor } from "@/modules/audit/audit";

// Lot-based stock operations (handoff Data-and-State-Model "Stock invariant").
// For every lot: available = onHand - reserved - committed, all non-negative, and
// onHand >= reserved + committed (enforced by a CHECK constraint as well). Every
// change writes an append-only movement with explicit deltas so the ledger can be
// reconciled against lot columns.

type LotRow = {
  id: string;
  variant_id: string;
  supplier_id: string | null;
  quantity_on_hand: number;
  reserved_qty: number;
  committed_qty: number;
  expiry_date: Date | null;
  received_at: Date;
};

export type Deltas = { onHand: number; reserved: number; committed: number };

export async function applyLotDelta(
  tx: Tx,
  lotId: string,
  deltas: Deltas,
  movement: {
    type: MovementType;
    reason: string;
    actor: Actor;
    orderId?: string | null;
    reservationId?: string | null;
    dedupeKey?: string | null;
  },
): Promise<void> {
  const updated = await tx.$executeRaw`
    UPDATE commerce.inventory_lots
       SET quantity_on_hand = quantity_on_hand + ${deltas.onHand},
           reserved_qty = reserved_qty + ${deltas.reserved},
           committed_qty = committed_qty + ${deltas.committed},
           version = version + 1
     WHERE id = ${lotId}::uuid
       AND quantity_on_hand + ${deltas.onHand} >= 0
       AND reserved_qty + ${deltas.reserved} >= 0
       AND committed_qty + ${deltas.committed} >= 0
       AND quantity_on_hand + ${deltas.onHand} >= reserved_qty + ${deltas.reserved} + committed_qty + ${deltas.committed}`;
  if (updated !== 1) {
    throw new DomainError("STOCK_CHANGED", "Stock levels changed. Reload and try again.");
  }
  await tx.inventoryMovement.create({
    data: {
      lotId,
      type: movement.type,
      onHandDelta: deltas.onHand,
      reservedDelta: deltas.reserved,
      committedDelta: deltas.committed,
      orderId: movement.orderId ?? null,
      reservationId: movement.reservationId ?? null,
      reason: movement.reason,
      actorType: movement.actor.type,
      actorId: movement.actor.id,
      dedupeKey: movement.dedupeKey ?? null,
      occurredAt: now(),
    },
  });
}

export type LineDemand = { orderLineId: string; variantId: string; quantity: number };
export type LotTake = { orderLineId: string; variantId: string; lotId: string; quantity: number };

/**
 * Locks every sellable lot for the requested variants in ascending id order (a
 * deterministic lock order prevents deadlocks between concurrent checkouts), then
 * picks lots earliest-expiry first, then oldest receipt, preserving the supplier
 * attribution of each lot. All-or-nothing: if any line cannot be fully satisfied the
 * caller's transaction must roll back; no partial basket is ever accepted.
 */
export async function lockAndPlanTakes(tx: Tx, demand: LineDemand[], scope: StockScope): Promise<LotTake[] | null> {
  if (demand.length === 0) return [];
  const variantIds = [...new Set(demand.map((d) => d.variantId))];
  const lots = await tx.$queryRaw<LotRow[]>`
    SELECT l.id, l.variant_id, l.supplier_id, l.quantity_on_hand, l.reserved_qty, l.committed_qty, l.expiry_date, l.received_at
      FROM commerce.inventory_lots l
     WHERE l.variant_id IN (${Prisma.join(variantIds.map((id) => Prisma.sql`${id}::uuid`))})
       AND ${sellableLotCondition("l", scope)}
     ORDER BY l.id
     FOR UPDATE`;

  const remaining = new Map(lots.map((l) => [l.id, l.quantity_on_hand - l.reserved_qty - l.committed_qty]));
  const takes: LotTake[] = [];
  for (const line of [...demand].sort((a, b) => (a.variantId < b.variantId ? -1 : 1))) {
    const candidates = lots
      .filter((l) => l.variant_id === line.variantId)
      .sort((a, b) => {
        const ea = a.expiry_date ? a.expiry_date.getTime() : Number.POSITIVE_INFINITY;
        const eb = b.expiry_date ? b.expiry_date.getTime() : Number.POSITIVE_INFINITY;
        if (ea !== eb) return ea - eb;
        return a.received_at.getTime() - b.received_at.getTime();
      });
    let needed = line.quantity;
    for (const lot of candidates) {
      if (needed === 0) break;
      const free = remaining.get(lot.id) ?? 0;
      if (free <= 0) continue;
      const take = Math.min(free, needed);
      remaining.set(lot.id, free - take);
      takes.push({ orderLineId: line.orderLineId, variantId: line.variantId, lotId: lot.id, quantity: take });
      needed -= take;
    }
    if (needed > 0) return null;
  }
  return takes;
}

/** Reserve planned takes against an order's reservation. */
export async function reserveTakes(
  tx: Tx,
  input: { takes: LotTake[]; reservationId: string; orderId: string; actor: Actor },
): Promise<void> {
  for (const take of input.takes) {
    await applyLotDelta(tx, take.lotId, { onHand: 0, reserved: take.quantity, committed: 0 }, {
      type: "RESERVE",
      reason: "Checkout reservation before payment",
      actor: input.actor,
      orderId: input.orderId,
      reservationId: input.reservationId,
    });
    await tx.reservationLine.create({
      data: {
        reservationId: input.reservationId,
        orderLineId: take.orderLineId,
        lotId: take.lotId,
        quantity: take.quantity,
      },
    });
  }
}
