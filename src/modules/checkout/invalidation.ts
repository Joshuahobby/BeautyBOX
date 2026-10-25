import "server-only";
import type { Tx } from "@/server/db";
import { now } from "@/modules/shared/clock";

/**
 * Any change to a priced input (basket, recipient, pin) increments the editable
 * checkout's revision and voids its quote, so a stale quote can never be paid
 * (T13). Checkouts with an unresolved payment are frozen and are never touched here;
 * callers reject edits for those before calling this.
 */
export async function invalidateEditableCheckout(tx: Tx, cartId: string): Promise<void> {
  const checkouts = await tx.checkout.findMany({
    where: { cartId, state: { in: ["EDITING", "REVIEWED"] } },
    select: { id: true },
  });
  for (const checkout of checkouts) {
    await tx.checkout.update({
      where: { id: checkout.id },
      data: { revision: { increment: 1 }, state: "EDITING", currentQuoteId: null, updatedAt: now() },
    });
    await tx.deliveryQuote.updateMany({
      where: { checkoutId: checkout.id, state: "VALID" },
      data: { state: "SUPERSEDED" },
    });
  }
}
