import "server-only";
import { randomUUID } from "node:crypto";
import { transaction, type Tx } from "@/server/db";
import { encryptField } from "@/server/crypto";
import { addSeconds, now } from "@/modules/shared/clock";
import { DomainError } from "@/modules/shared/errors";
import { sumRwf, toRwf } from "@/modules/shared/money";
import { maskPhone, normalizeRwandaMobile } from "@/modules/shared/phone";
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from "@/modules/idempotency/idempotency";
import { assertBasketPurchasable, evaluateBasket } from "@/modules/cart/basket";
import { assertSaleFlowOpen, kigaliToday, operatingContext } from "@/modules/settings/settings";
import { lockOwnCheckout } from "@/modules/checkout/checkout";
import { lockAndPlanTakes, reserveTakes } from "@/modules/inventory/stock";
import { enqueueJob } from "@/modules/jobs/outbox";
import { audit } from "@/modules/audit/audit";
import { newOrderReference } from "@/modules/orders/reference";
import type { GuestSession } from "@/modules/session/guest-session";
import type { PaymentMethodCode } from "@/adapters/payments/types";
import { enabledPaymentMethods } from "./methods";
import { paymentProviderCode } from "./provider";

// Start-payment transaction (handoff Data-and-State-Model "Start-payment
// transaction"). Everything that must be true before money is requested is checked
// and frozen in ONE database transaction; the provider is called afterwards, outside
// any lock, by the durable outbox job created here.
//
// Lock order used across the payment code: checkout -> cart -> order -> attempt ->
// reservation -> lots (ascending id) -> receipt. Keeping one order avoids deadlocks.

export type PayRequest = {
  expectedRevision: number;
  quoteId: string;
  acceptedTotalRwf: number;
  method: PaymentMethodCode;
  payerPhone: string;
};

export const PAYMENT_INITIATE_KEY = (depositId: string) => `deposit-initiate:${depositId}`;
export const PAYMENT_CHECK_KEY = (depositId: string) => `deposit-check:${depositId}`;
export const RESERVATION_EXPIRY_KEY = (reservationId: string) => `reservation-expiry:${reservationId}`;

export async function startPayment(
  session: GuestSession,
  checkoutId: string,
  body: PayRequest,
  idempotencyKey: string,
  requestId: string | null,
): Promise<{ attemptId: string; replayed: boolean }> {
  const payer = normalizeRwandaMobile(body.payerPhone);
  if (!payer.ok) {
    throw new DomainError("VALIDATION_ERROR", "Enter the mobile money number that will approve this payment.", {
      fieldErrors: [{ field: "payerPhone", message: "Enter the mobile money number that will approve this payment." }],
    });
  }
  // Provider/config reads happen outside the transaction (no HTTP while holding locks);
  // the gates themselves are applied after the idempotency claim, so an identical retry
  // of an accepted intent always replays it even if checkout was paused in between.
  const methods = await enabledPaymentMethods();
  const ctx = await operatingContext();

  return transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, {
      scope: `guest:${session.id}:start-payment:${checkoutId}`,
      key: idempotencyKey,
      requestHash: requestHash("startPayment", { checkoutId, ...body, payerPhone: payer.e164 }),
    });
    if (claim.kind === "REPLAY") return { attemptId: claim.resourceId, replayed: true };

    assertSaleFlowOpen(ctx);
    if (methods.temporarilyUnavailable && methods.methods.length === 0) {
      throw new DomainError("PROVIDER_UNAVAILABLE", "Mobile money payment is temporarily unavailable. Your basket is saved.");
    }
    if (!methods.methods.includes(body.method)) {
      throw new DomainError("VALIDATION_ERROR", "Choose an available mobile money network.", {
        fieldErrors: [{ field: "method", message: "Choose an available mobile money network." }],
      });
    }

    // 1. Checkout: one unresolved attempt per checkout, current revision only.
    const checkout = await lockOwnCheckout(tx, session, checkoutId);
    if (checkout.state === "PAYMENT_PENDING") {
      throw new DomainError("PAYMENT_UNRESOLVED", "A payment for this order is still being checked. Do not pay again.");
    }
    if (checkout.state === "CONVERTED") throw new DomainError("ACTION_NOT_ALLOWED", "This order is already paid.");
    if (checkout.state === "EXPIRED" || checkout.expiresAt <= now()) {
      throw new DomainError("ACTION_NOT_ALLOWED", "This checkout has expired. Return to your cart to start again.");
    }
    if (checkout.revision !== body.expectedRevision) {
      throw new DomainError("VERSION_CONFLICT", "Your checkout changed in another window. We've reloaded the latest details.");
    }

    // 2. Quote: the current, unexpired quote for this exact revision, origin and tariff.
    const quote = checkout.currentQuoteId ? await tx.deliveryQuote.findUnique({ where: { id: checkout.currentQuoteId } }) : null;
    if (!quote || quote.id !== body.quoteId || quote.checkoutRevision !== checkout.revision || quote.state !== "VALID") {
      throw new DomainError("QUOTE_INVALID", "Your delivery charge needs updating. Review the new total before paying.");
    }
    if (quote.validUntil <= now()) {
      throw new DomainError("QUOTE_EXPIRED", "Delivery fee needs updating. Recalculate before paying.");
    }
    if (quote.tariffId !== ctx.tariff.id || quote.tariffVersion !== ctx.tariff.version || quote.originLocationId !== ctx.location.id || quote.originVersion !== ctx.location.version) {
      throw new DomainError("QUOTE_INVALID", "Your delivery charge changed. Review the new total before paying.");
    }

    // 3. Basket: lock the cart, revalidate prices/publication/stock; must match the quote.
    await tx.$queryRaw`SELECT id FROM commerce.carts WHERE id = ${checkout.cartId}::uuid FOR UPDATE`;
    const scope = { locationId: ctx.location.id, todayKigali: kigaliToday(now()) };
    const basket = await evaluateBasket(tx, checkout.cartId, scope);
    assertBasketPurchasable(basket);
    if (basket.fingerprint !== quote.basketFingerprint) {
      throw new DomainError("QUOTE_INVALID", "Your basket changed. Review the new total before paying.");
    }

    // 4. Server-derived money. The client's figure only confirms what was reviewed.
    const productsRwf = basket.subtotalRwf;
    const deliveryRwf = toRwf(quote.amountRwf);
    const totalRwf = sumRwf([productsRwf, deliveryRwf]);
    if (body.acceptedTotalRwf !== totalRwf) {
      throw new DomainError("QUOTE_INVALID", "Your total changed. Review the new total before paying.");
    }

    // 5. Order with a fresh immutable snapshot for this payment intent.
    const order = await upsertOrderSnapshot(tx, {
      session,
      checkout,
      quote,
      ctx,
      basket,
      productsRwf,
      deliveryRwf,
      totalRwf,
    });

    // 6. One attempt with a fresh provider deposit id, persisted before any provider call.
    const at = now();
    const depositId = randomUUID();
    const attempt = await tx.paymentAttempt.create({
      data: {
        orderId: order.id,
        provider: paymentProviderCode(),
        providerDepositId: depositId,
        orderSnapshotRevision: order.snapshotRevision,
        amountRwf: BigInt(totalRwf),
        method: body.method,
        payerPhoneEncrypted: encryptField(payer.e164),
        payerPhoneMasked: maskPhone(payer.e164),
        state: "CREATED",
        nextCheckAt: addSeconds(at, 5),
        createdAt: at,
      },
    });

    // 7. All-or-nothing stock reservation against sellable lots.
    const reservation = await tx.reservation.create({
      data: {
        checkoutId: checkout.id,
        orderId: order.id,
        paymentAttemptId: attempt.id,
        expiresAt: addSeconds(at, ctx.settings.reservationTtlSeconds),
        createdAt: at,
      },
    });
    const lines = await tx.orderLine.findMany({ where: { orderId: order.id, snapshotRevision: order.snapshotRevision } });
    const takes = await lockAndPlanTakes(
      tx,
      lines.map((l) => ({ orderLineId: l.id, variantId: l.variantId, quantity: l.quantity })),
      scope,
    );
    if (!takes) {
      throw new DomainError("STOCK_CHANGED", "The available quantity changed. Review your basket to continue.");
    }
    const actor = { type: "CUSTOMER" as const, id: null };
    await reserveTakes(tx, { takes, reservationId: reservation.id, orderId: order.id, actor });

    // 8. Durable intents: initiate the deposit, keep checking it, expire the reservation.
    await enqueueJob(tx, { type: "PAYMENT_INITIATE", uniqueIntentKey: PAYMENT_INITIATE_KEY(depositId), entityId: attempt.id, dueAt: at });
    await enqueueJob(tx, { type: "PAYMENT_CHECK", uniqueIntentKey: PAYMENT_CHECK_KEY(depositId), entityId: attempt.id, dueAt: addSeconds(at, 5) });
    await enqueueJob(tx, {
      type: "RESERVATION_EXPIRY",
      uniqueIntentKey: RESERVATION_EXPIRY_KEY(reservation.id),
      entityId: reservation.id,
      dueAt: reservation.expiresAt,
    });

    // 9. Freeze: the quote is used, the checkout cannot change while payment is pending.
    await tx.deliveryQuote.update({ where: { id: quote.id }, data: { state: "USED", usedAt: at } });
    await tx.checkout.update({ where: { id: checkout.id }, data: { state: "PAYMENT_PENDING" } });
    await tx.order.update({ where: { id: order.id }, data: { paymentState: "PENDING", version: { increment: 1 } } });

    await audit(tx, {
      actor,
      entityType: "order",
      entityId: order.id,
      action: "PAYMENT_STARTED",
      after: { attemptId: attempt.id, amountRwf: totalRwf, method: body.method, snapshotRevision: order.snapshotRevision },
      requestId,
    });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "payment_attempt", resourceId: attempt.id, responseStatus: 202 });
    return { attemptId: attempt.id, replayed: false };
  });
}

async function upsertOrderSnapshot(
  tx: Tx,
  input: {
    session: GuestSession;
    checkout: Awaited<ReturnType<typeof lockOwnCheckout>>;
    quote: NonNullable<Awaited<ReturnType<Tx["deliveryQuote"]["findUnique"]>>>;
    ctx: Awaited<ReturnType<typeof operatingContext>>;
    basket: Awaited<ReturnType<typeof evaluateBasket>>;
    productsRwf: number;
    deliveryRwf: number;
    totalRwf: number;
  },
) {
  const { checkout, quote, ctx, basket } = input;
  if (!checkout.recipientName || !checkout.recipientPhone || !checkout.recipientEmail || checkout.destinationLat === null || checkout.destinationLng === null) {
    throw new DomainError("VALIDATION_ERROR", "Recipient, e-mail address and delivery pin are required.");
  }
  const existingRows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM commerce.orders WHERE checkout_id = ${checkout.id}::uuid FOR UPDATE`;
  const snapshot = {
    recipientName: checkout.recipientName,
    recipientPhone: checkout.recipientPhone,
    recipientEmail: checkout.recipientEmail,
    landmark: checkout.landmark,
    instructions: checkout.instructions,
    destinationLat: checkout.destinationLat,
    destinationLng: checkout.destinationLng,
    originLocationId: ctx.location.id,
    originVersion: ctx.location.version,
    originLabel: ctx.location.label,
    originLat: ctx.location.lat,
    originLng: ctx.location.lng,
    deliveryQuoteId: quote.id,
    tariffVersion: quote.tariffVersion,
    distanceMetres: quote.distanceMetres,
    productsRwf: BigInt(input.productsRwf),
    deliveryRwf: BigInt(input.deliveryRwf),
    totalRwf: BigInt(input.totalRwf),
  };
  const dataOrigin = basket.lines.length > 0 ? await basketDataOrigin(tx, basket.lines.map((l) => l.productId)) : "SYNTHETIC_DEMO";

  let order;
  if (existingRows.length === 0) {
    order = await tx.order.create({
      data: {
        reference: newOrderReference(),
        sellerId: ctx.location.sellerId,
        checkoutId: checkout.id,
        guestSessionId: input.session.id,
        snapshotRevision: 1,
        dataOrigin,
        ...snapshot,
      },
    });
  } else {
    const existing = await tx.order.findUniqueOrThrow({ where: { id: existingRows[0]!.id } });
    // Only an unpaid order whose previous attempts all failed verifiably may take a new intent.
    if (existing.state !== "AWAITING_PAYMENT") {
      throw new DomainError("ACTION_NOT_ALLOWED", "This order can no longer be paid.");
    }
    const unresolved = await tx.paymentAttempt.count({ where: { orderId: existing.id, state: { in: ["CREATED", "PENDING"] } } });
    const receipts = await tx.paymentReceipt.count({ where: { orderId: existing.id } });
    if (unresolved > 0) throw new DomainError("PAYMENT_UNRESOLVED", "A payment for this order is still being checked. Do not pay again.");
    if (receipts > 0) throw new DomainError("ACTION_NOT_ALLOWED", "This order already has a payment. Contact support.");
    order = await tx.order.update({
      where: { id: existing.id },
      data: { ...snapshot, dataOrigin, snapshotRevision: { increment: 1 }, version: { increment: 1 } },
    });
  }

  for (const line of basket.lines) {
    await tx.orderLine.create({
      data: {
        orderId: order.id,
        snapshotRevision: order.snapshotRevision,
        variantId: line.variantId,
        sku: line.sku,
        title: line.title,
        attributes: line.attributes,
        unitPriceRwf: BigInt(line.unitPriceRwf),
        quantity: line.quantity,
        lineTotalRwf: BigInt(line.lineTotalRwf),
      },
    });
  }
  return order;
}

async function basketDataOrigin(tx: Tx, productIds: string[]) {
  const products = await tx.product.findMany({ where: { id: { in: productIds } }, select: { dataOrigin: true } });
  return products.every((p) => p.dataOrigin === "VERIFIED") ? ("VERIFIED" as const) : ("SYNTHETIC_DEMO" as const);
}
