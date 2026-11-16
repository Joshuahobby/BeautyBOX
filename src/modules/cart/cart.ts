import "server-only";
import { db, transaction, type Tx } from "@/server/db";
import { now } from "@/modules/shared/clock";
import { DomainError, notFound } from "@/modules/shared/errors";
import { serverEnv } from "@/server/env";
import { sellableLotCondition } from "@/modules/inventory/eligibility";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  requestHash,
} from "@/modules/idempotency/idempotency";
import { kigaliToday, currentSettings } from "@/modules/settings/settings";
import { evaluateBasket, type LineIssue } from "./basket";
import type { GuestSession } from "@/modules/session/guest-session";
import { invalidateEditableCheckout } from "@/modules/checkout/invalidation";

export const MAX_LINE_QUANTITY = 99;

export type CartLineView = {
  variantId: string;
  productSlug: string;
  title: string;
  sku: string;
  attributes: Record<string, string>;
  quantity: number;
  unitPriceRwf: number;
  previousUnitPriceRwf: number | null;
  lineTotalRwf: number;
  availableQuantity: number;
  issues: LineIssue[];
};

export type CartView = {
  id: string;
  version: number;
  lines: CartLineView[];
  subtotalRwf: number;
  currency: "RWF";
  expiresAt: string;
  canCheckout: boolean;
  paymentPending: boolean;
  checkoutId: string | null;
};

async function scopeFor(tx: Tx | ReturnType<typeof db>) {
  const settings = await currentSettings(tx);
  return {
    locationId: settings.activeLocationId,
    todayKigali: kigaliToday(now()),
  };
}

async function activeCartFor(
  client: Tx | ReturnType<typeof db>,
  sessionId: string,
) {
  return client.cart.findFirst({
    where: { guestSessionId: sessionId, state: "ACTIVE" },
  });
}

export async function getCartView(session: GuestSession): Promise<CartView> {
  const client = db();
  const cart = await activeCartFor(client, session.id);
  if (!cart) throw notFound();
  return buildView(client, cart.id);
}

async function buildView(
  client: Tx | ReturnType<typeof db>,
  cartId: string,
): Promise<CartView> {
  const cart = await client.cart.findUniqueOrThrow({ where: { id: cartId } });
  const basket = await evaluateBasket(client, cartId, await scopeFor(client));
  const checkout = await client.checkout.findFirst({
    where: {
      cartId,
      state: { in: ["EDITING", "REVIEWED", "PAYMENT_PENDING"] },
    },
    orderBy: { createdAt: "desc" },
  });
  const paymentPending = checkout?.state === "PAYMENT_PENDING";
  return {
    id: cart.id,
    version: cart.version,
    currency: "RWF",
    expiresAt: cart.expiresAt.toISOString(),
    subtotalRwf: basket.subtotalRwf,
    canCheckout: basket.canCheckout && !paymentPending,
    paymentPending,
    checkoutId: checkout?.id ?? null,
    lines: basket.lines.map((l) => ({
      variantId: l.variantId,
      productSlug: l.productSlug,
      title: l.title,
      sku: l.sku,
      attributes: l.attributes,
      quantity: l.quantity,
      unitPriceRwf: l.unitPriceRwf,
      previousUnitPriceRwf: l.issues.includes("PRICE_CHANGED")
        ? l.seenPriceRwf
        : null,
      lineTotalRwf: l.lineTotalRwf,
      availableQuantity: l.availableQuantity,
      issues: l.issues,
    })),
  };
}

async function lockActiveCart(
  tx: Tx,
  sessionId: string,
  expectedVersion: number,
) {
  // Global lock order is checkout -> cart (same as start-payment), so lock the
  // cart's open checkouts first, then the cart itself.
  const candidate = await tx.cart.findFirst({
    where: { guestSessionId: sessionId, state: "ACTIVE" },
    select: { id: true },
  });
  if (!candidate) throw notFound();
  await tx.$queryRaw`
    SELECT id FROM commerce.checkouts
     WHERE cart_id = ${candidate.id}::uuid AND state IN ('EDITING', 'REVIEWED', 'PAYMENT_PENDING')
     ORDER BY id FOR UPDATE`;
  const rows = await tx.$queryRaw<{ id: string; version: number }[]>`
    SELECT id, version FROM commerce.carts
     WHERE id = ${candidate.id}::uuid AND state = 'ACTIVE'
     FOR UPDATE`;
  const cart = rows[0];
  if (!cart) throw notFound();
  if (cart.version !== expectedVersion) {
    throw new DomainError(
      "VERSION_CONFLICT",
      "Your cart changed in another window. We've loaded the latest version.",
    );
  }
  const pending = await tx.checkout.findFirst({
    where: { cartId: cart.id, state: "PAYMENT_PENDING" },
  });
  if (pending) {
    throw new DomainError(
      "PAYMENT_UNRESOLVED",
      "A payment for this cart is still being checked. Your cart can't be changed until it is resolved.",
    );
  }
  return cart;
}

async function bumpCart(tx: Tx, cartId: string) {
  await tx.cart.update({
    where: { id: cartId },
    data: { version: { increment: 1 }, updatedAt: now() },
  });
  await invalidateEditableCheckout(tx, cartId);
}

export async function setCartLine(
  session: GuestSession,
  input: { variantId: string; quantity: number; expectedVersion: number },
  idempotencyKey: string,
): Promise<CartView> {
  if (
    !Number.isSafeInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > MAX_LINE_QUANTITY
  ) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Choose a quantity between 1 and 99.",
      {
        fieldErrors: [
          { field: "quantity", message: "Choose a quantity between 1 and 99." },
        ],
      },
    );
  }
  const cartId = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, {
      scope: `guest:${session.id}:cart-line`,
      key: idempotencyKey,
      requestHash: requestHash("setCartLine", input),
    });
    if (claim.kind === "REPLAY") return claim.resourceId;

    const cart = await lockActiveCart(tx, session.id, input.expectedVersion);
    const scope = await scopeFor(tx);
    const variant = await tx.variant.findUnique({
      where: { id: input.variantId },
      include: { product: true },
    });
    if (!variant)
      throw new DomainError("VALIDATION_ERROR", "This item is unavailable.", {
        httpStatus: 422,
      });

    const existing = await tx.cartLine.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
    });
    // Evaluate availability through the same rules as the basket.
    const probe = await evaluateProbe(tx, variant.id, scope);
    if (!probe.visible) {
      throw new DomainError(
        "STOCK_CHANGED",
        "This item is no longer available.",
        {
          fieldErrors: [
            {
              field: "variantId",
              message: "This item is no longer available.",
            },
          ],
        },
      );
    }
    const reducing = existing !== null && input.quantity < existing.quantity;
    if (!reducing && input.quantity > probe.available) {
      const message =
        probe.available === 0
          ? "This item is out of stock."
          : `The available quantity changed. Only ${probe.available} can be added right now.`;
      throw new DomainError("STOCK_CHANGED", message, {
        fieldErrors: [{ field: "quantity", message }],
      });
    }

    await tx.cartLine.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
      create: {
        cartId: cart.id,
        variantId: variant.id,
        quantity: input.quantity,
        seenPriceRwf: variant.priceRwf,
      },
      update: {
        quantity: input.quantity,
        seenPriceRwf: variant.priceRwf,
        updatedAt: now(),
      },
    });
    await bumpCart(tx, cart.id);
    await completeIdempotencyKey(tx, claim.recordId, {
      resourceType: "cart",
      resourceId: cart.id,
      responseStatus: 200,
    });
    return cart.id;
  });
  return buildView(db(), cartId);
}

/** Replace a shade atomically. The old line remains intact on every failure. */
export async function replaceCartLine(
  session: GuestSession,
  input: {
    variantId: string;
    replacementVariantId: string;
    expectedVersion: number;
  },
  idempotencyKey: string,
): Promise<CartView> {
  const cartId = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, {
      scope: `guest:${session.id}:cart-line-replace`,
      key: idempotencyKey,
      requestHash: requestHash("replaceCartLine", input),
    });
    if (claim.kind === "REPLAY") return claim.resourceId;
    const cart = await lockActiveCart(tx, session.id, input.expectedVersion);
    const source = await tx.cartLine.findUnique({
      where: {
        cartId_variantId: { cartId: cart.id, variantId: input.variantId },
      },
      include: { variant: true },
    });
    if (!source)
      throw new DomainError(
        "VERSION_CONFLICT",
        "This cart item changed. Reload your cart and try again.",
      );
    if (input.variantId !== input.replacementVariantId) {
      const replacement = await tx.variant.findUnique({
        where: { id: input.replacementVariantId },
      });
      if (!replacement || replacement.productId !== source.variant.productId)
        throw new DomainError(
          "VALIDATION_ERROR",
          "Choose an option of the same product.",
          { httpStatus: 422 },
        );
      const existing = await tx.cartLine.findUnique({
        where: {
          cartId_variantId: { cartId: cart.id, variantId: replacement.id },
        },
      });
      const quantity = source.quantity + (existing?.quantity ?? 0);
      const probe = await evaluateProbe(tx, replacement.id, await scopeFor(tx));
      if (
        !probe.visible ||
        quantity > probe.available ||
        quantity > MAX_LINE_QUANTITY
      )
        throw new DomainError(
          "STOCK_CHANGED",
          "That option cannot hold this quantity. Your original item is still in your cart.",
        );
      await tx.cartLine.upsert({
        where: {
          cartId_variantId: { cartId: cart.id, variantId: replacement.id },
        },
        create: {
          cartId: cart.id,
          variantId: replacement.id,
          quantity,
          seenPriceRwf: replacement.priceRwf,
        },
        update: {
          quantity,
          seenPriceRwf: replacement.priceRwf,
          updatedAt: now(),
        },
      });
      await tx.cartLine.delete({
        where: {
          cartId_variantId: { cartId: cart.id, variantId: source.variantId },
        },
      });
      await bumpCart(tx, cart.id);
    }
    await completeIdempotencyKey(tx, claim.recordId, {
      resourceType: "cart",
      resourceId: cart.id,
      responseStatus: 200,
    });
    return cart.id;
  });
  return buildView(db(), cartId);
}

export async function removeCartLine(
  session: GuestSession,
  input: { variantId: string; expectedVersion: number },
  idempotencyKey: string,
): Promise<CartView> {
  const cartId = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, {
      scope: `guest:${session.id}:cart-line-remove`,
      key: idempotencyKey,
      requestHash: requestHash("removeCartLine", input),
    });
    if (claim.kind === "REPLAY") return claim.resourceId;
    const cart = await lockActiveCart(tx, session.id, input.expectedVersion);
    const deleted = await tx.cartLine.deleteMany({
      where: { cartId: cart.id, variantId: input.variantId },
    });
    if (deleted.count > 0) await bumpCart(tx, cart.id);
    await completeIdempotencyKey(tx, claim.recordId, {
      resourceType: "cart",
      resourceId: cart.id,
      responseStatus: 200,
    });
    return cart.id;
  });
  return buildView(db(), cartId);
}

async function evaluateProbe(
  tx: Tx,
  variantId: string,
  scope: { locationId: string; todayKigali: string },
) {
  const demoVisible = serverEnv().DEMO_CATALOG_VISIBLE;
  const variant = await tx.variant.findUniqueOrThrow({
    where: { id: variantId },
    include: { product: true },
  });
  const visible =
    variant.isActive &&
    variant.product.publishState === "PUBLISHED" &&
    (demoVisible || variant.product.dataOrigin === "VERIFIED");
  if (!visible) return { visible: false, available: 0 };
  const rows = await tx.$queryRaw<{ available: bigint | null }[]>`
    SELECT SUM(l.quantity_on_hand - l.reserved_qty - l.committed_qty) AS available
      FROM commerce.inventory_lots l
     WHERE l.variant_id = ${variantId}::uuid AND ${sellableLotCondition("l", scope)}`;
  return {
    visible: true,
    available: Math.max(0, Number(rows[0]?.available ?? 0)),
  };
}
