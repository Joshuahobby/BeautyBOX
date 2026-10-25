import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { getProductBySlug, listCategories, listProducts } from "@/modules/catalog/catalog";
import { getCartView, removeCartLine, setCartLine } from "@/modules/cart/cart";
import { createOrReuseCheckout, getCheckoutView, updateCheckout } from "@/modules/checkout/checkout";
import { requestQuote } from "@/modules/delivery/quote";
import { getCustomerOrderView, getPaymentAttemptView } from "@/modules/orders/customer-views";
import { ownerQuery } from "./harness";
import {
  DEST_3KM,
  DEST_5KM,
  DEST_NO_ROUTE,
  DEST_OUTSIDE,
  DEST_ROUTE_DOWN,
  addToCart,
  drainJobs,
  expectDomainError,
  key,
  newCustomer,
  pay,
  readyCheckout,
  resetDatabase,
  seedShop,
  settleAndDrain,
  type Shop,
} from "./harness";

let shop: Shop;

beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
});

describe("catalog (CAT-01, CAT-02, CAT-04)", () => {
  it("shows only published products; drafts are unreachable by direct URL", async () => {
    expect(await getProductBySlug("draft-item")).toBeNull();
    const page = await listProducts({});
    expect(page.items.map((p) => p.slug)).not.toContain("draft-item");
    expect(page.items.map((p) => p.slug)).toContain("test-cleanser");
  });

  it("reports per-variant availability without exposing lots or costs", async () => {
    const lip = await getProductBySlug("test-lip");
    expect(lip?.variants.map((v) => [v.attributes.shade, v.isAvailable])).toEqual([
      ["Brownie", true],
      ["Royal", false],
    ]);
    expect(JSON.stringify(lip)).not.toMatch(/cost|supplier|lot/i);
  });

  it("composes search, category, price and availability filters", async () => {
    expect((await listProducts({ q: "cleanser" })).items.map((p) => p.slug)).toEqual(["test-cleanser"]);
    expect((await listProducts({ category: "skincare" })).items.map((p) => p.slug).sort()).toEqual(
      ["bulky-item", "last-unit-serum", "test-cleanser"],
    );
    expect((await listProducts({ minPriceRwf: 13000, maxPriceRwf: 21000 })).items.map((p) => p.slug).sort()).toEqual(
      ["last-unit-serum", "test-cleanser"],
    );
    expect((await listProducts({ q: "zzz-none" })).items).toHaveLength(0);
    const sorted = await listProducts({ sort: "PRICE_ASC" });
    expect(sorted.items[0]!.slug).toBe("test-lip");
  });

  it("lists only published, non-empty categories", async () => {
    const slugs = (await listCategories()).map((c) => c.slug);
    expect(slugs).toEqual(expect.arrayContaining(["skincare", "cleansers", "makeup"]));
  });

  it("paginates with an opaque cursor", async () => {
    const first = await listProducts({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listProducts({ limit: 2, cursor: first.nextCursor });
    expect(second.items.map((p) => p.id)).not.toContain(first.items[0]!.id);
    await expectDomainError(listProducts({ cursor: "not-a-cursor" }), "VALIDATION_ERROR");
  });
});

describe("guest cart", () => {
  it("validates quantity against authoritative stock without silent clamping", async () => {
    const customer = await newCustomer();
    await expectDomainError(addToCart(customer, shop.lipBrownie.id, 4), "STOCK_CHANGED");
    await expectDomainError(addToCart(customer, shop.lipRoyal.id, 1), "STOCK_CHANGED");
    await expectDomainError(addToCart(customer, shop.draft.id, 1), "STOCK_CHANGED");
    const cart = await addToCart(customer, shop.lipBrownie.id, 3);
    expect(cart.lines[0]!.quantity).toBe(3);
    expect(cart.subtotalRwf).toBe(36000);
  });

  it("rejects a stale cart version and replays an identical request", async () => {
    const customer = await newCustomer();
    const cart = await getCartView(customer);
    const k = key();
    const a = await setCartLine(customer, { variantId: shop.cleanser.id, quantity: 1, expectedVersion: cart.version }, k);
    const b = await setCartLine(customer, { variantId: shop.cleanser.id, quantity: 1, expectedVersion: cart.version }, k);
    expect(b.version).toBe(a.version);
    await expectDomainError(
      setCartLine(customer, { variantId: shop.cleanser.id, quantity: 2, expectedVersion: cart.version }, key()),
      "VERSION_CONFLICT",
    );
  });

  it("T22: another visitor's cart and checkout are not reachable", async () => {
    const owner = await newCustomer();
    const intruder = await newCustomer();
    await addToCart(owner, shop.cleanser.id, 1);
    const ready = await readyCheckout(owner);
    await expectDomainError(getCheckoutView(intruder, ready.checkout.id), "NOT_FOUND");
    const ownerCart = await getCartView(owner);
    await expectDomainError(
      createOrReuseCheckout(intruder, { cartId: ownerCart.id, expectedCartVersion: ownerCart.version }, key()),
      "NOT_FOUND",
    );
    await expectDomainError(pay(intruder, ready), "NOT_FOUND");
    const { attemptId } = await pay(owner, ready);
    await expectDomainError(getPaymentAttemptView(attemptId, { guestSession: intruder, orderSessionTokens: [] }), "NOT_FOUND");
    const order = await db().order.findFirstOrThrow();
    await expectDomainError(getCustomerOrderView(order.id, { guestSession: intruder, orderSessionTokens: [] }), "NOT_FOUND");
    await expectDomainError(getCustomerOrderView(order.id, { guestSession: null, orderSessionTokens: ["guessed-token-value-guessed-token-value-guessed"] }), "NOT_FOUND");
  });

  it("freezes the basket while a payment is unresolved", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    await pay(customer, await readyCheckout(customer));
    await expectDomainError(addToCart(customer, shop.cleanser.id, 2), "PAYMENT_UNRESOLVED");
    const cart = await getCartView(customer);
    await expectDomainError(removeCartLine(customer, { variantId: shop.cleanser.id, expectedVersion: cart.version }, key()), "PAYMENT_UNRESOLVED");
  });

  it("starts a fresh cart after a verified paid order", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const paidCart = await getCartView(customer);
    await pay(customer, await readyCheckout(customer));
    await drainJobs();
    await settleAndDrain();
    expect((await db().cart.findUniqueOrThrow({ where: { id: paidCart.id } })).state).toBe("CONVERTED");
    const { createOrReuseGuestSession } = await import("@/modules/session/guest-session");
    const again = await createOrReuseGuestSession(customer.token);
    expect(again.token).toBeNull(); // same session, no rotation
    const fresh = await getCartView(customer);
    expect(fresh.id).not.toBe(paidCart.id);
    expect(fresh.lines).toHaveLength(0);
  });
});

describe("delivery quote (DEL-01..07, AT04-AT06, T13, T14)", () => {
  it("prices the proposed tariff boundaries exactly: 3.0 km = 1,500 and 5.0 km = 2,100", async () => {
    const a = await newCustomer();
    await addToCart(a, shop.cleanser.id, 1);
    expect((await readyCheckout(a, DEST_3KM)).quote.amountRwf).toBe(1500);
    const b = await newCustomer();
    await addToCart(b, shop.cleanser.id, 1);
    expect((await readyCheckout(b, DEST_5KM)).quote.amountRwf).toBe(2100);
  });

  it("refuses unsupported destinations and routing failures without a guessed fee", async () => {
    for (const [dest, code] of [
      [DEST_OUTSIDE, "OUTSIDE_COVERAGE"],
      [DEST_NO_ROUTE, "OUTSIDE_COVERAGE"],
      [DEST_ROUTE_DOWN, "PROVIDER_UNAVAILABLE"],
    ] as const) {
      const c = await newCustomer();
      await addToCart(c, shop.cleanser.id, 1);
      await expectDomainError(readyCheckout(c, dest), code);
    }
    expect(await db().deliveryQuote.count()).toBe(0);
  });

  it("rejects a basket that needs special delivery", async () => {
    const c = await newCustomer();
    await addToCart(c, shop.bulky.id, 1);
    await expectDomainError(readyCheckout(c), "VALIDATION_ERROR");
  });

  it("invalidates the quote when the pin changes and rejects paying the stale revision", async () => {
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const ready = await readyCheckout(c);
    await updateCheckout(c, ready.checkout.id, {
      expectedRevision: ready.checkout.revision,
      recipient: { name: "Test Recipient", phone: "+250788555111" },
      destination: DEST_3KM,
      destinationConfirmed: "CUSTOMER_CONFIRMED",
    }, key());
    await expectDomainError(pay(c, ready), "VERSION_CONFLICT");
  });

  it("invalidates the quote when the basket changes", async () => {
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const ready = await readyCheckout(c);
    await addToCart(c, shop.cleanser.id, 2);
    await expectDomainError(pay(c, ready), "VERSION_CONFLICT");
    const checkout = await getCheckoutView(c, ready.checkout.id);
    expect(checkout.quoteId).toBeNull();
  });

  it("invalidates the quote when a price changes after quoting", async () => {
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const ready = await readyCheckout(c);
    await db().variant.update({ where: { id: shop.cleanser.id }, data: { priceRwf: 16000n, priceVersion: { increment: 1 } } });
    await expectDomainError(pay(c, ready), "QUOTE_INVALID");
  });

  it("invalidates the quote when the tariff changes after quoting", async () => {
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const ready = await readyCheckout(c);
    const tariff = await db().tariff.create({
      data: { version: 2, baseRwf: 2000n, includedMetres: 3000, extraRwfPerKm: 300n, roundingRwf: 100n, maxDistanceMetres: 25000,
        coverageRules: (await db().tariff.findFirstOrThrow()).coverageRules as object, approvalState: "DEMO", dataOrigin: "SYNTHETIC_DEMO", reason: "test change" },
    });
    const s = await db().settingsVersion.findFirstOrThrow();
    const { id: _id, version: _v, createdAt: _c, supportContact: _sc, ...rest } = s;
    await db().settingsVersion.create({ data: { ...rest, version: 2, activeTariffId: tariff.id, reason: "tariff v2" } });
    await expectDomainError(pay(c, ready), "QUOTE_INVALID");
  });

  it("ignores a client-supplied total and requires the server total", async () => {
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const ready = await readyCheckout(c);
    await expectDomainError(pay(c, ready, { acceptedTotalRwf: 100 }), "QUOTE_INVALID");
    expect(await db().paymentAttempt.count()).toBe(0);
  });

  it("expires a quote after its lifetime", async () => {
    const { advanceSeconds } = await import("./harness");
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const ready = await readyCheckout(c);
    advanceSeconds(901);
    await expectDomainError(pay(c, ready), "QUOTE_EXPIRED");
  });

  it("requires valid recipient phone and a pin inside Rwanda", async () => {
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const cart = await getCartView(c);
    const checkout = await createOrReuseCheckout(c, { cartId: cart.id, expectedCartVersion: cart.version }, key());
    await expectDomainError(updateCheckout(c, checkout.id, {
      expectedRevision: checkout.revision, recipient: { name: "X", phone: "+250701234567" },
      destination: DEST_5KM, destinationConfirmed: "CUSTOMER_CONFIRMED",
    }, key()), "VALIDATION_ERROR");
    await expectDomainError(updateCheckout(c, checkout.id, {
      expectedRevision: checkout.revision, recipient: { name: "X", phone: "+250788555111" },
      destination: { lat: 51.5, lng: -0.12 }, destinationConfirmed: "CUSTOMER_CONFIRMED",
    }, key()), "OUTSIDE_COVERAGE");
    const quoteWithoutPin = requestQuote(c, checkout.id, { expectedRevision: checkout.revision }, key());
    await expectDomainError(quoteWithoutPin, "VALIDATION_ERROR");
  });

  it("closes the sale flow when checkout is paused, while reads keep working", async () => {
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const ready = await readyCheckout(c);
    const s = await db().settingsVersion.findFirstOrThrow();
    const { id: _id, version: _v, createdAt: _c, supportContact: _sc, ...rest } = s;
    await db().settingsVersion.create({ data: { ...rest, version: 2, checkoutEnabled: false, reason: "pause" } });
    await expectDomainError(pay(c, ready), "PROVIDER_UNAVAILABLE");
    expect((await getCheckoutView(c, ready.checkout.id)).state).toBe("REVIEWED");
  });
});

describe("T24 merchant-enabled methods", () => {
  it("only accepts methods that are both approved and enabled for the merchant", async () => {
    await ownerQuery(`UPDATE devsim.settings SET enabled_methods = ARRAY['MTN_MOMO_RWA']`);
    const { clearPaymentMethodCache, enabledPaymentMethods } = await import("@/modules/payments/methods");
    clearPaymentMethodCache();
    expect((await enabledPaymentMethods()).methods).toEqual(["MTN_MOMO_RWA"]);
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    await expectDomainError(pay(c, await readyCheckout(c), { method: "AIRTEL_RWA" }), "VALIDATION_ERROR");
  });
});
