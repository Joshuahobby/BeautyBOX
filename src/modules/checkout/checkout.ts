import "server-only";
import { db, transaction, type Tx } from "@/server/db";
import type { Checkout } from "@/generated/prisma/client";
import { now } from "@/modules/shared/clock";
import { DomainError, notFound } from "@/modules/shared/errors";
import { toRwf, sumRwf } from "@/modules/shared/money";
import { normalizeRwandaMobile } from "@/modules/shared/phone";
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from "@/modules/idempotency/idempotency";
import { assertBasketPurchasable, evaluateBasket } from "@/modules/cart/basket";
import { currentSettings, kigaliToday } from "@/modules/settings/settings";
import type { GuestSession } from "@/modules/session/guest-session";

export type RecipientInput = { name: string; phone: string; landmark?: string; instructions?: string };
export type PointInput = { lat: number; lng: number };

export type CheckoutView = {
  id: string;
  cartId: string;
  revision: number;
  state: Checkout["state"];
  recipient: { name: string; phone: string; landmark?: string; instructions?: string } | null;
  destination: PointInput | null;
  destinationConfirmed: boolean;
  quoteId: string | null;
  productsRwf: number;
  deliveryRwf: number | null;
  totalRwf: number | null;
  expiresAt: string;
  // Additions (docs/CONTRACT-CHANGES.md CC-01): recovery of an existing intent.
  quote: { id: string; amountRwf: number; validUntil: string; tariffVersion: number; serviceDescription: string } | null;
  orderId: string | null;
  orderReference: string | null;
  activeAttemptId: string | null;
  lastAttempt: { id: string; state: string } | null;
};

export async function lockOwnCheckout(tx: Tx, session: GuestSession, checkoutId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM commerce.checkouts
     WHERE id = ${checkoutId}::uuid AND guest_session_id = ${session.id}::uuid
     FOR UPDATE`;
  if (rows.length === 0) throw notFound();
  return tx.checkout.findUniqueOrThrow({ where: { id: checkoutId } });
}

export async function getCheckoutView(session: GuestSession, checkoutId: string): Promise<CheckoutView> {
  const checkout = await db().checkout.findFirst({ where: { id: checkoutId, guestSessionId: session.id } });
  if (!checkout) throw notFound();
  return buildCheckoutView(checkout);
}

export async function buildCheckoutView(checkout: Checkout): Promise<CheckoutView> {
  const client = db();
  const settings = await currentSettings(client);
  const basket = await evaluateBasket(client, checkout.cartId, {
    locationId: settings.activeLocationId,
    todayKigali: kigaliToday(now()),
  });
  const quote = checkout.currentQuoteId
    ? await client.deliveryQuote.findUnique({ where: { id: checkout.currentQuoteId } })
    : null;
  const order = await client.order.findUnique({
    where: { checkoutId: checkout.id },
    include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const lastAttempt = order?.attempts[0] ?? null;
  const unresolved = lastAttempt && (lastAttempt.state === "CREATED" || lastAttempt.state === "PENDING") ? lastAttempt : null;

  // While a payment is pending the frozen order snapshot is the truth, not the live cart.
  const productsRwf =
    checkout.state === "PAYMENT_PENDING" || checkout.state === "CONVERTED"
      ? toRwf(order?.productsRwf ?? 0n)
      : basket.subtotalRwf;
  const deliveryRwf =
    checkout.state === "PAYMENT_PENDING" || checkout.state === "CONVERTED"
      ? toRwf(order?.deliveryRwf ?? 0n)
      : quote && quote.state === "VALID"
        ? toRwf(quote.amountRwf)
        : null;

  return {
    id: checkout.id,
    cartId: checkout.cartId,
    revision: checkout.revision,
    state: checkout.state,
    recipient:
      checkout.recipientName && checkout.recipientPhone
        ? {
            name: checkout.recipientName,
            phone: checkout.recipientPhone,
            ...(checkout.landmark ? { landmark: checkout.landmark } : {}),
            ...(checkout.instructions ? { instructions: checkout.instructions } : {}),
          }
        : null,
    destination:
      checkout.destinationLat !== null && checkout.destinationLng !== null
        ? { lat: Number(checkout.destinationLat), lng: Number(checkout.destinationLng) }
        : null,
    destinationConfirmed: checkout.destinationConfirmedAt !== null,
    quoteId: quote && quote.state === "VALID" ? quote.id : null,
    productsRwf,
    deliveryRwf,
    totalRwf: deliveryRwf === null ? null : sumRwf([productsRwf, deliveryRwf]),
    expiresAt: checkout.expiresAt.toISOString(),
    quote:
      quote && quote.state === "VALID"
        ? {
            id: quote.id,
            amountRwf: toRwf(quote.amountRwf),
            validUntil: quote.validUntil.toISOString(),
            tariffVersion: quote.tariffVersion,
            serviceDescription: quoteServiceDescription(quote.routeProvider),
          }
        : null,
    orderId: order?.id ?? null,
    orderReference: order?.reference ?? null,
    activeAttemptId: unresolved?.id ?? null,
    lastAttempt: lastAttempt ? { id: lastAttempt.id, state: lastAttempt.state } : null,
  };
}

export function quoteServiceDescription(routeProvider: string): string {
  return routeProvider === "FAKE"
    ? "Motorcycle delivery from BeautyBOX (demo tariff and simulated route)"
    : "Motorcycle delivery from BeautyBOX";
}

export async function createOrReuseCheckout(
  session: GuestSession,
  input: { cartId: string; expectedCartVersion: number },
  idempotencyKey: string,
): Promise<CheckoutView> {
  const checkoutId = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, {
      scope: `guest:${session.id}:checkout`,
      key: idempotencyKey,
      requestHash: requestHash("createCheckout", input),
    });
    if (claim.kind === "REPLAY") return claim.resourceId;

    const carts = await tx.$queryRaw<{ id: string; version: number; expires_at: Date }[]>`
      SELECT id, version, expires_at FROM commerce.carts
       WHERE id = ${input.cartId}::uuid AND guest_session_id = ${session.id}::uuid AND state = 'ACTIVE'
       FOR UPDATE`;
    const cart = carts[0];
    if (!cart) throw notFound();
    if (cart.version !== input.expectedCartVersion) {
      throw new DomainError("VERSION_CONFLICT", "Your cart changed in another window. We've loaded the latest version.");
    }
    let checkout = await tx.checkout.findFirst({
      where: { cartId: cart.id, state: { in: ["EDITING", "REVIEWED", "PAYMENT_PENDING"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!checkout || checkout.state !== "PAYMENT_PENDING") {
      const settings = await currentSettings(tx);
      const basket = await evaluateBasket(tx, cart.id, {
        locationId: settings.activeLocationId,
        todayKigali: kigaliToday(now()),
      });
      assertBasketPurchasable(basket);
      // Proceeding from the cart, where changed prices were shown, acknowledges them.
      for (const line of basket.lines.filter((l) => l.issues.includes("PRICE_CHANGED"))) {
        await tx.cartLine.update({
          where: { cartId_variantId: { cartId: cart.id, variantId: line.variantId } },
          data: { seenPriceRwf: BigInt(line.unitPriceRwf) },
        });
      }
    }
    if (!checkout) {
      checkout = await tx.checkout.create({
        data: { cartId: cart.id, guestSessionId: session.id, expiresAt: cart.expires_at },
      });
    }
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "checkout", resourceId: checkout.id, responseStatus: 201 });
    return checkout.id;
  });
  return getCheckoutView(session, checkoutId);
}

const RWANDA_BOUNDS = { minLat: -2.9, maxLat: -1.0, minLng: 28.8, maxLng: 30.95 };

export function validateRecipient(input: RecipientInput): {
  name: string;
  phone: string;
  landmark: string | null;
  instructions: string | null;
} {
  const fieldErrors: { field: string; message: string }[] = [];
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 120) fieldErrors.push({ field: "recipient.name", message: "Enter the recipient's name." });
  const phone = normalizeRwandaMobile(input.phone);
  if (!phone.ok) fieldErrors.push({ field: "recipient.phone", message: "Enter a phone number we can use for delivery." });
  const landmark = input.landmark?.trim() || null;
  const instructions = input.instructions?.trim() || null;
  if (landmark && landmark.length > 240) fieldErrors.push({ field: "recipient.landmark", message: "Use 240 characters or fewer." });
  if (instructions && instructions.length > 500) {
    fieldErrors.push({ field: "recipient.instructions", message: "Use 500 characters or fewer." });
  }
  if (fieldErrors.length > 0 || !phone.ok) {
    throw new DomainError("VALIDATION_ERROR", "Check the highlighted details.", { fieldErrors });
  }
  return { name, phone: phone.e164, landmark, instructions };
}

export function validateDestination(point: PointInput): PointInput {
  const valid =
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= RWANDA_BOUNDS.minLat &&
    point.lat <= RWANDA_BOUNDS.maxLat &&
    point.lng >= RWANDA_BOUNDS.minLng &&
    point.lng <= RWANDA_BOUNDS.maxLng;
  if (!valid) {
    throw new DomainError("OUTSIDE_COVERAGE", "Delivery is not available to this location yet. Choose another location or contact us.", {
      fieldErrors: [{ field: "destination", message: "Choose a delivery pin in Rwanda." }],
    });
  }
  // Six decimal places (~0.1 m) matches the stored precision.
  return { lat: Math.round(point.lat * 1e6) / 1e6, lng: Math.round(point.lng * 1e6) / 1e6 };
}

export async function updateCheckout(
  session: GuestSession,
  checkoutId: string,
  input: { expectedRevision: number; recipient: RecipientInput; destination: PointInput; destinationConfirmed: "CUSTOMER_CONFIRMED" },
  idempotencyKey: string,
): Promise<CheckoutView> {
  const recipient = validateRecipient(input.recipient);
  const destination = validateDestination(input.destination);
  if (input.destinationConfirmed !== "CUSTOMER_CONFIRMED") {
    throw new DomainError("VALIDATION_ERROR", "Confirm the delivery pin.", {
      fieldErrors: [{ field: "destinationConfirmed", message: "Set and confirm the delivery pin." }],
    });
  }
  await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, {
      scope: `guest:${session.id}:checkout-update:${checkoutId}`,
      key: idempotencyKey,
      requestHash: requestHash("updateCheckout", input),
    });
    if (claim.kind === "REPLAY") return;
    const checkout = await lockOwnCheckout(tx, session, checkoutId);
    assertEditable(checkout);
    if (checkout.revision !== input.expectedRevision) {
      throw new DomainError("VERSION_CONFLICT", "Your checkout changed in another window. We've reloaded the latest details.");
    }
    const unchanged =
      checkout.recipientName === recipient.name &&
      checkout.recipientPhone === recipient.phone &&
      (checkout.landmark ?? null) === recipient.landmark &&
      (checkout.instructions ?? null) === recipient.instructions &&
      checkout.destinationLat !== null &&
      Number(checkout.destinationLat) === destination.lat &&
      Number(checkout.destinationLng) === destination.lng &&
      checkout.destinationConfirmedAt !== null;
    if (!unchanged) {
      await tx.checkout.update({
        where: { id: checkout.id },
        data: {
          recipientName: recipient.name,
          recipientPhone: recipient.phone,
          landmark: recipient.landmark,
          instructions: recipient.instructions,
          destinationLat: destination.lat,
          destinationLng: destination.lng,
          destinationConfirmedAt: now(),
          revision: { increment: 1 },
          state: "EDITING",
          currentQuoteId: null,
        },
      });
      await tx.deliveryQuote.updateMany({ where: { checkoutId: checkout.id, state: "VALID" }, data: { state: "SUPERSEDED" } });
    }
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "checkout", resourceId: checkout.id, responseStatus: 200 });
  });
  return getCheckoutView(session, checkoutId);
}

export function assertEditable(checkout: Checkout): void {
  if (checkout.state === "PAYMENT_PENDING") {
    throw new DomainError("PAYMENT_UNRESOLVED", "A payment for this order is still being checked. Do not pay again.");
  }
  if (checkout.state === "CONVERTED" || checkout.state === "EXPIRED") {
    throw new DomainError("ACTION_NOT_ALLOWED", "This checkout is closed.");
  }
  if (checkout.expiresAt <= now()) {
    throw new DomainError("ACTION_NOT_ALLOWED", "This checkout has expired. Return to your cart to start again.");
  }
}
