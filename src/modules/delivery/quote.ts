import "server-only";
import { z } from "zod";
import { db, transaction } from "@/server/db";
import { routingAdapter } from "@/adapters/registry";
import { addSeconds, now } from "@/modules/shared/clock";
import { DomainError, notFound } from "@/modules/shared/errors";
import { toRwf } from "@/modules/shared/money";
import { sha256Hex } from "@/server/crypto";
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from "@/modules/idempotency/idempotency";
import { assertBasketPurchasable, evaluateBasket } from "@/modules/cart/basket";
import { kigaliToday, operatingContext, publicationBlocks } from "@/modules/settings/settings";
import { serverEnv } from "@/server/env";
import { assertEditable, lockOwnCheckout, quoteServiceDescription } from "@/modules/checkout/checkout";
import type { GuestSession } from "@/modules/session/guest-session";
import { isInsideCoverage, parseCoverage } from "./coverage";
import { deliveryFeeRwf } from "./tariff";

// Server delivery quote (DEL-02..07). The route is fetched outside any database lock;
// the quote is then bound to the exact checkout revision, basket fingerprint, origin
// version and tariff version. Routing failure never produces a guessed fee.

export type QuoteView = {
  id: string;
  checkoutId: string;
  checkoutRevision: number;
  amountRwf: number;
  currency: "RWF";
  tariffVersion: number;
  validUntil: string;
  serviceDescription: string;
};

const parcelRulesSchema = z.object({ maxTotalUnits: z.number().int().positive() }).passthrough();

export async function requestQuote(
  session: GuestSession,
  checkoutId: string,
  input: { expectedRevision: number },
  idempotencyKey: string,
): Promise<QuoteView> {
  const scope = `guest:${session.id}:quote:${checkoutId}`;
  const hash = requestHash("quoteDelivery", input);

  // Replay before calling the route provider again.
  const keyHash = sha256Hex(idempotencyKey);
  const prior = await db().idempotencyRecord.findUnique({ where: { scope_keyHash: { scope, keyHash } } });
  if (prior) {
    if (prior.requestHash !== hash) {
      throw new DomainError("IDEMPOTENCY_CONFLICT", "This request key was already used for a different request.");
    }
    if (prior.resourceId) return quoteView(prior.resourceId);
  }

  const checkout = await db().checkout.findFirst({ where: { id: checkoutId, guestSessionId: session.id } });
  if (!checkout) throw notFound();
  assertEditable(checkout);
  if (checkout.revision !== input.expectedRevision) {
    throw new DomainError("VERSION_CONFLICT", "Your checkout changed in another window. We've reloaded the latest details.");
  }
  if (!checkout.recipientName || checkout.destinationLat === null || checkout.destinationLng === null || !checkout.destinationConfirmedAt) {
    throw new DomainError("VALIDATION_ERROR", "Set and confirm the delivery pin.", {
      fieldErrors: [{ field: "destination", message: "Set and confirm the delivery pin." }],
    });
  }

  const ctx = await operatingContext();
  if (serverEnv().APP_ENV === "production" && publicationBlocks(ctx).some((b) => b !== "CHECKOUT_DISABLED")) {
    throw new DomainError("PROVIDER_UNAVAILABLE", "Delivery quotes are not available yet. Your basket is saved.");
  }
  const basket = await evaluateBasket(db(), checkout.cartId, {
    locationId: ctx.location.id,
    todayKigali: kigaliToday(now()),
  });
  assertBasketPurchasable(basket);
  const parcel = parcelRulesSchema.parse(ctx.location.parcelRules);
  const units = basket.lines.reduce((sum, l) => sum + l.quantity, 0);
  if (units > parcel.maxTotalUnits) {
    throw new DomainError("VALIDATION_ERROR", "This order is larger than our standard delivery parcel.", {
      fieldErrors: [{ field: "parcel", message: `Standard delivery carries up to ${parcel.maxTotalUnits} items.` }],
    });
  }

  const destination = { lat: Number(checkout.destinationLat), lng: Number(checkout.destinationLng) };
  const origin = { lat: Number(ctx.location.lat), lng: Number(ctx.location.lng) };
  const outside = () =>
    new DomainError("OUTSIDE_COVERAGE", "Delivery is not available to this location yet. Choose another location or contact us.");
  if (!isInsideCoverage(destination, parseCoverage(ctx.tariff.coverageRules))) throw outside();

  const route = await routingAdapter().route(origin, destination);
  if (route.kind === "UNAVAILABLE") {
    throw new DomainError("PROVIDER_UNAVAILABLE", "We couldn't calculate delivery right now. Your basket is saved. Please try again.");
  }
  if (route.kind === "NO_ROUTE" || route.distanceMetres > ctx.tariff.maxDistanceMetres) throw outside();

  const amountRwf = deliveryFeeRwf(route.distanceMetres, {
    baseRwf: toRwf(ctx.tariff.baseRwf),
    includedMetres: ctx.tariff.includedMetres,
    extraRwfPerKm: toRwf(ctx.tariff.extraRwfPerKm),
    roundingRwf: toRwf(ctx.tariff.roundingRwf),
  });
  // Distance is kept only where the routing provider's terms allow it (Decisions §4).
  const retainDistance = routingAdapter().provider === "FAKE";

  const quoteId = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, { scope, key: idempotencyKey, requestHash: hash });
    if (claim.kind === "REPLAY") return claim.resourceId;
    const locked = await lockOwnCheckout(tx, session, checkoutId);
    assertEditable(locked);
    if (locked.revision !== input.expectedRevision) {
      throw new DomainError("VERSION_CONFLICT", "Your checkout changed in another window. We've reloaded the latest details.");
    }
    await tx.deliveryQuote.updateMany({ where: { checkoutId, state: "VALID" }, data: { state: "SUPERSEDED" } });
    const at = now();
    const quote = await tx.deliveryQuote.create({
      data: {
        checkoutId,
        checkoutRevision: locked.revision,
        basketFingerprint: basket.fingerprint,
        originLocationId: ctx.location.id,
        originVersion: ctx.location.version,
        originLat: ctx.location.lat,
        originLng: ctx.location.lng,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
        distanceMetres: retainDistance ? route.distanceMetres : null,
        amountRwf: BigInt(amountRwf),
        tariffId: ctx.tariff.id,
        tariffVersion: ctx.tariff.version,
        routeProvider: routingAdapter().provider,
        providerEvidenceRef: route.evidenceRef,
        validUntil: addSeconds(at, ctx.settings.quoteTtlSeconds),
        createdAt: at,
      },
    });
    await tx.checkout.update({ where: { id: checkoutId }, data: { state: "REVIEWED", currentQuoteId: quote.id } });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "quote", resourceId: quote.id, responseStatus: 200 });
    return quote.id;
  });
  return quoteView(quoteId);
}

async function quoteView(quoteId: string): Promise<QuoteView> {
  const quote = await db().deliveryQuote.findUniqueOrThrow({ where: { id: quoteId } });
  return {
    id: quote.id,
    checkoutId: quote.checkoutId,
    checkoutRevision: quote.checkoutRevision,
    amountRwf: toRwf(quote.amountRwf),
    currency: "RWF",
    tariffVersion: quote.tariffVersion,
    validUntil: quote.validUntil.toISOString(),
    serviceDescription: quoteServiceDescription(quote.routeProvider),
  };
}
