import "server-only";
import { transaction, type Tx } from "@/server/db";
import { now } from "@/modules/shared/clock";
import { audit, type Actor } from "@/modules/audit/audit";
import { kigaliToday, currentSettings } from "@/modules/settings/settings";
import { commitReservation, lockReservationForAttempt, reallocateAndCommit, releaseReservation } from "@/modules/inventory/reservations";
import { openRefundCase } from "@/modules/refunds/cases";
import { createNotificationIntent } from "@/modules/notifications/intents";

// Application of VERIFIED provider outcomes (handoff Data-and-State-Model "Apply
// verified success" and "Expiry and uncertain outcomes"). Callers must have verified
// the result through the authoritative provider status lookup; browser redirects,
// timers, screenshots and unverified callbacks never reach this module.

export type VerifiedSuccess = {
  amountRwf: number | null;
  currency: string;
  providerTransactionId: string | null;
  providerStatus: string;
  evidenceRef: string;
};

export type SuccessResult =
  | "APPLIED"
  | "ON_HOLD"
  | "DUPLICATE"
  | "OVERPAYMENT"
  | "AFTER_CANCELLATION"
  | "MISMATCH"
  | "REVIEW";

const PROVIDER_ACTOR: Actor = { type: "PROVIDER", id: null };

/** Lock order: checkout -> order -> attempt (-> reservation -> lots), as in start-payment. */
async function lockPaymentAggregate(tx: Tx, attemptId: string) {
  const ref = await tx.paymentAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: { orderId: true, order: { select: { checkoutId: true } } },
  });
  await tx.$queryRaw`SELECT id FROM commerce.checkouts WHERE id = ${ref.order.checkoutId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM commerce.orders WHERE id = ${ref.orderId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM commerce.payment_attempts WHERE id = ${attemptId}::uuid FOR UPDATE`;
  const attempt = await tx.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const order = await tx.order.findUniqueOrThrow({ where: { id: ref.orderId } });
  const checkout = await tx.checkout.findUniqueOrThrow({ where: { id: ref.order.checkoutId } });
  return { attempt, order, checkout };
}

export async function applyVerifiedSuccess(attemptId: string, outcome: VerifiedSuccess): Promise<SuccessResult> {
  return transaction(async (tx) => {
    const { attempt, order, checkout } = await lockPaymentAggregate(tx, attemptId);
    const at = now();

    // One receipt per deposit: a repeated or replayed success is a no-op (T05).
    const prior = await tx.paymentReceipt.findUnique({ where: { attemptId } });
    if (prior) return "DUPLICATE";

    const expected = Number(attempt.amountRwf);
    const amountMatches = outcome.amountRwf === expected && outcome.currency === "RWF";

    if (!amountMatches) {
      // Collected, but not what was agreed: finance exception, never fulfillable (PAY-03, T06).
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          state: "SUCCEEDED",
          verificationFlag: "MISMATCH",
          providerStatus: outcome.providerStatus,
          resolvedAt: at,
          checkedAt: at,
        },
      });
      if (outcome.amountRwf !== null && outcome.amountRwf > 0) {
        const receipt = await tx.paymentReceipt.create({
          data: {
            attemptId: attempt.id,
            orderId: order.id,
            providerTransactionId: outcome.providerTransactionId,
            verifiedAmountRwf: BigInt(outcome.amountRwf),
            currency: outcome.currency,
            disposition: "REVIEW",
            evidenceRef: outcome.evidenceRef,
            verifiedAt: at,
          },
        });
        await openRefundCase(tx, { orderId: order.id, receiptId: receipt.id, source: "PAYMENT_REVIEW", reason: "Collected amount or currency differs from the agreed total" });
      }
      await releaseIfActive(tx, attempt.id, order.id, "Payment amount mismatch under finance review");
      if (order.state === "AWAITING_PAYMENT") {
        await tx.order.update({
          where: { id: order.id },
          data: { state: "ON_HOLD", holdReason: "PAYMENT_REVIEW", paymentState: "EXCEPTION", version: { increment: 1 } },
        });
      } else {
        await tx.order.update({ where: { id: order.id }, data: { paymentState: "EXCEPTION", version: { increment: 1 } } });
      }
      if (checkout.state === "PAYMENT_PENDING") await tx.checkout.update({ where: { id: checkout.id }, data: { state: "CONVERTED" } });
      await audit(tx, {
        actor: PROVIDER_ACTOR,
        entityType: "payment_attempt",
        entityId: attempt.id,
        action: "PAYMENT_AMOUNT_MISMATCH",
        after: { expectedRwf: expected, reportedRwf: outcome.amountRwf, currency: outcome.currency },
      });
      return "MISMATCH";
    }

    const appliedReceipts = await tx.paymentReceipt.count({ where: { orderId: order.id, disposition: "APPLIED" } });
    const disposition =
      order.state === "CANCELLED"
        ? "AFTER_CANCELLATION"
        : appliedReceipts > 0
          ? "OVERPAYMENT"
          : attempt.orderSnapshotRevision !== order.snapshotRevision
            ? "REVIEW"
            : "APPLIED";

    const receipt = await tx.paymentReceipt.create({
      data: {
        attemptId: attempt.id,
        orderId: order.id,
        providerTransactionId: outcome.providerTransactionId,
        verifiedAmountRwf: BigInt(expected),
        currency: "RWF",
        disposition,
        evidenceRef: outcome.evidenceRef,
        verifiedAt: at,
      },
    });
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        state: "SUCCEEDED",
        // A success after a recorded failure is a conflicting terminal result: keep it visible.
        verificationFlag: attempt.state === "FAILED" || disposition === "REVIEW" ? "NEEDS_REVIEW" : null,
        providerStatus: outcome.providerStatus,
        resolvedAt: at,
        checkedAt: at,
      },
    });

    if (disposition === "AFTER_CANCELLATION") {
      // Never revive fulfillment for a cancelled order; the money goes back (T10, AT11).
      await releaseIfActive(tx, attempt.id, order.id, "Order cancelled before payment was verified");
      await openRefundCase(tx, { orderId: order.id, receiptId: receipt.id, source: "CANCELLATION", reason: "Payment verified after the order was cancelled" });
      await tx.order.update({ where: { id: order.id }, data: { paymentState: "PAID", version: { increment: 1 } } });
      await closeCheckout(tx, checkout.id, checkout.state);
      await audit(tx, { actor: PROVIDER_ACTOR, entityType: "order", entityId: order.id, action: "PAYMENT_AFTER_CANCELLATION", after: { receiptId: receipt.id } });
      return "AFTER_CANCELLATION";
    }

    if (disposition === "OVERPAYMENT") {
      // Fulfil once; the extra collection is held for refund (FSD section 8).
      await releaseIfActive(tx, attempt.id, order.id, "Extra collection for an already paid order");
      await openRefundCase(tx, { orderId: order.id, receiptId: receipt.id, source: "OVERPAYMENT", reason: "Additional successful collection for an already paid order" });
      await audit(tx, { actor: PROVIDER_ACTOR, entityType: "order", entityId: order.id, action: "PAYMENT_OVERPAYMENT", after: { receiptId: receipt.id } });
      return "OVERPAYMENT";
    }

    if (disposition === "REVIEW") {
      await releaseIfActive(tx, attempt.id, order.id, "Superseded payment intent succeeded");
      await openRefundCase(tx, { orderId: order.id, receiptId: receipt.id, source: "PAYMENT_REVIEW", reason: "A superseded payment intent was collected" });
      await audit(tx, { actor: PROVIDER_ACTOR, entityType: "order", entityId: order.id, action: "PAYMENT_NEEDS_REVIEW", after: { receiptId: receipt.id } });
      return "REVIEW";
    }

    // APPLIED: commit the reservation, or reallocate the whole basket after a release (T07/T08).
    const reservation = await lockReservationForAttempt(tx, attempt.id);
    let allocated: boolean;
    if (reservation && reservation.state === "ACTIVE") {
      await commitReservation(tx, reservation.id, order.id, PROVIDER_ACTOR);
      allocated = true;
    } else {
      const settings = await currentSettings(tx);
      const lines = await tx.orderLine.findMany({ where: { orderId: order.id, snapshotRevision: order.snapshotRevision } });
      allocated = await reallocateAndCommit(tx, {
        orderId: order.id,
        lines: lines.map((l) => ({ orderLineId: l.id, variantId: l.variantId, quantity: l.quantity })),
        scope: { locationId: settings.activeLocationId, todayKigali: kigaliToday(at) },
        actor: PROVIDER_ACTOR,
      });
    }

    await tx.order.update({
      where: { id: order.id },
      data: allocated
        ? { state: "PAID", paymentState: "PAID", paidAt: at, holdReason: null, version: { increment: 1 } }
        : { state: "ON_HOLD", holdReason: "STOCK_UNAVAILABLE", paymentState: "PAID", paidAt: at, version: { increment: 1 } },
    });
    if (!allocated) {
      await openRefundCase(tx, {
        orderId: order.id,
        receiptId: receipt.id,
        source: "STOCK_HOLD",
        reason: "Paid order could not be fully allocated; resolve stock or refund",
      });
    }
    await closeCheckout(tx, checkout.id, checkout.state);
    await convertCartAndOpenFresh(tx, checkout.cartId);
    await createNotificationIntent(tx, { orderId: order.id, event: allocated ? "ORDER_CONFIRMED" : "ORDER_ON_HOLD" });
    await audit(tx, {
      actor: PROVIDER_ACTOR,
      entityType: "order",
      entityId: order.id,
      action: allocated ? "PAYMENT_VERIFIED_ALLOCATED" : "PAYMENT_VERIFIED_ON_HOLD",
      after: { receiptId: receipt.id, attemptId: attempt.id, amountRwf: expected },
    });
    return allocated ? "APPLIED" : "ON_HOLD";
  });
}

export async function applyVerifiedFailure(
  attemptId: string,
  outcome: { failureCode: string; providerStatus: string },
): Promise<"FAILED" | "DUPLICATE" | "IGNORED_AFTER_SUCCESS"> {
  return transaction(async (tx) => {
    const { attempt, order, checkout } = await lockPaymentAggregate(tx, attemptId);
    if (attempt.state === "SUCCEEDED") {
      // Never downgrade a verified success because of an older or conflicting message (T05).
      await audit(tx, { actor: PROVIDER_ACTOR, entityType: "payment_attempt", entityId: attempt.id, action: "FAILURE_IGNORED_AFTER_SUCCESS" });
      return "IGNORED_AFTER_SUCCESS";
    }
    if (attempt.state === "FAILED") return "DUPLICATE";
    const at = now();
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        state: "FAILED",
        failureCode: outcome.failureCode,
        providerStatus: outcome.providerStatus,
        verificationFlag: null,
        resolvedAt: at,
        checkedAt: at,
      },
    });
    await releaseIfActive(tx, attempt.id, order.id, "Verified payment failure");
    const receipts = await tx.paymentReceipt.count({ where: { orderId: order.id } });
    if (receipts === 0 && order.paymentState === "PENDING") {
      await tx.order.update({ where: { id: order.id }, data: { paymentState: "UNPAID", version: { increment: 1 } } });
    }
    // Only a verified failure reopens the path to a new attempt, and only after a new review.
    if (checkout.state === "PAYMENT_PENDING") {
      await tx.checkout.update({ where: { id: checkout.id }, data: { state: "EDITING", currentQuoteId: null } });
    }
    await audit(tx, {
      actor: PROVIDER_ACTOR,
      entityType: "payment_attempt",
      entityId: attempt.id,
      action: "PAYMENT_FAILED",
      after: { failureCode: outcome.failureCode },
    });
    return "FAILED";
  });
}

/**
 * Reservation expiry while the payment is still unresolved: release the stock but
 * keep the payment unresolved (a timer never produces FAILED). Re-reads state under
 * locks so a concurrent success that already committed the reservation wins (T07).
 */
export async function releaseReservationStillUnresolved(attemptId: string): Promise<"RELEASED" | "NOOP"> {
  return transaction(async (tx) => {
    const { attempt, order } = await lockPaymentAggregate(tx, attemptId);
    const reservation = await lockReservationForAttempt(tx, attemptId);
    if (!reservation || reservation.state !== "ACTIVE") return "NOOP";
    if (attempt.state !== "CREATED" && attempt.state !== "PENDING") return "NOOP";
    await releaseReservation(tx, reservation.id, order.id, "EXPIRED", "Reservation expired while payment unresolved", { type: "SYSTEM", id: null });
    await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { verificationFlag: "UNKNOWN" } });
    await audit(tx, { actor: { type: "SYSTEM", id: null }, entityType: "reservation", entityId: reservation.id, action: "RESERVATION_EXPIRED_PAYMENT_UNRESOLVED" });
    return "RELEASED";
  });
}

async function releaseIfActive(tx: Tx, attemptId: string, orderId: string, reason: string) {
  const reservation = await lockReservationForAttempt(tx, attemptId);
  if (reservation && reservation.state === "ACTIVE") {
    await releaseReservation(tx, reservation.id, orderId, "RELEASED", reason, PROVIDER_ACTOR);
  }
}

/** The paid cart is converted and the same guest session immediately gets a new empty cart. */
async function convertCartAndOpenFresh(tx: Tx, cartId: string) {
  const cart = await tx.cart.findUniqueOrThrow({ where: { id: cartId }, include: { guestSession: true } });
  await tx.$queryRaw`SELECT id FROM commerce.guest_sessions WHERE id = ${cart.guestSessionId}::uuid FOR UPDATE`;
  if (cart.state === "ACTIVE") await tx.cart.update({ where: { id: cartId }, data: { state: "CONVERTED" } });
  const active = await tx.cart.findFirst({ where: { guestSessionId: cart.guestSessionId, state: "ACTIVE" } });
  if (!active) await tx.cart.create({ data: { guestSessionId: cart.guestSessionId, expiresAt: cart.guestSession.expiresAt } });
}

async function closeCheckout(tx: Tx, checkoutId: string, state: string) {
  if (state !== "CONVERTED") await tx.checkout.update({ where: { id: checkoutId }, data: { state: "CONVERTED" } });
}
