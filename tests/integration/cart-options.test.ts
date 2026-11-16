import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { replaceCartLine, getCartView } from "@/modules/cart/cart";
import { receiveStock } from "@/modules/dev/fixtures";
import { getCheckoutView } from "@/modules/checkout/checkout";
import { GUEST_COOKIE } from "@/modules/session/guest-session";
import { PATCH } from "@/app/api/v1/cart/lines/[variantId]/route";
import {
  addToCart,
  expectDomainError,
  key,
  newCustomer,
  pay,
  PHONES,
  readyCheckout,
  resetDatabase,
  seedShop,
  type Shop,
} from "./harness";

let shop: Shop;
beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
});
async function stock(variantId: string, quantity = 10) {
  await receiveStock({
    variantId,
    locationId: shop.location.id,
    quantity,
    ownership: "OWNED",
    supplierId: null,
    costBasisRwf: null,
    expiryDate: null,
    batchReference: randomUUID(),
    dataOrigin: "SYNTHETIC_DEMO",
  });
}

describe("atomic cart option changes", () => {
  it("preserves quantity, uses the target price and replays without merging twice", async () => {
    await stock(shop.lipRoyal.id);
    await db().variant.update({
      where: { id: shop.lipRoyal.id },
      data: { priceRwf: 14000n },
    });
    const customer = await newCustomer();
    const cart = await addToCart(customer, shop.lipBrownie.id, 2);
    const input = {
      variantId: shop.lipBrownie.id,
      replacementVariantId: shop.lipRoyal.id,
      expectedVersion: cart.version,
    };
    const idempotency = key();
    const changed = await replaceCartLine(customer, input, idempotency);
    expect(changed.version).toBe(cart.version + 1);
    expect(changed.lines).toHaveLength(1);
    expect(changed.lines[0]).toMatchObject({
      variantId: shop.lipRoyal.id,
      quantity: 2,
      unitPriceRwf: 14000,
    });
    expect(changed.subtotalRwf).toBe(28000);
    expect(await replaceCartLine(customer, input, idempotency)).toEqual(
      changed,
    );
    await expectDomainError(
      replaceCartLine(
        customer,
        { ...input, replacementVariantId: shop.lipBrownie.id },
        idempotency,
      ),
      "IDEMPOTENCY_CONFLICT",
    );
  });
  it("merges an existing target line once", async () => {
    await stock(shop.lipRoyal.id);
    const customer = await newCustomer();
    await addToCart(customer, shop.lipRoyal.id, 2);
    const cart = await addToCart(customer, shop.lipBrownie.id, 2);
    const changed = await replaceCartLine(
      customer,
      {
        variantId: shop.lipBrownie.id,
        replacementVariantId: shop.lipRoyal.id,
        expectedVersion: cart.version,
      },
      key(),
    );
    expect(changed.lines).toHaveLength(1);
    expect(changed.lines[0]?.quantity).toBe(4);
  });
  it("keeps the original cart on unavailable stock or cross-product selection", async () => {
    const customer = await newCustomer();
    const cart = await addToCart(customer, shop.lipBrownie.id, 2);
    await expectDomainError(
      replaceCartLine(
        customer,
        {
          variantId: shop.lipBrownie.id,
          replacementVariantId: shop.lipRoyal.id,
          expectedVersion: cart.version,
        },
        key(),
      ),
      "STOCK_CHANGED",
    );
    await expectDomainError(
      replaceCartLine(
        customer,
        {
          variantId: shop.lipBrownie.id,
          replacementVariantId: shop.cleanser.id,
          expectedVersion: cart.version,
        },
        key(),
      ),
      "VALIDATION_ERROR",
    );
    expect(await getCartView(customer)).toEqual(cart);
  });
  it("refuses a merged quantity above the per-line limit without truncation", async () => {
    await stock(shop.lipRoyal.id, 110);
    const customer = await newCustomer();
    await addToCart(customer, shop.lipRoyal.id, 99);
    const cart = await addToCart(customer, shop.lipBrownie.id, 1);
    await expectDomainError(
      replaceCartLine(
        customer,
        {
          variantId: shop.lipBrownie.id,
          replacementVariantId: shop.lipRoyal.id,
          expectedVersion: cart.version,
        },
        key(),
      ),
      "STOCK_CHANGED",
    );
    expect(await getCartView(customer)).toEqual(cart);
  });
  it("same-option selection is a version-checked no-op", async () => {
    const customer = await newCustomer();
    const cart = await addToCart(customer, shop.lipBrownie.id, 1);
    const same = await replaceCartLine(
      customer,
      {
        variantId: shop.lipBrownie.id,
        replacementVariantId: shop.lipBrownie.id,
        expectedVersion: cart.version,
      },
      key(),
    );
    expect(same).toEqual(cart);
    await expectDomainError(
      replaceCartLine(
        customer,
        {
          variantId: shop.lipBrownie.id,
          replacementVariantId: shop.lipBrownie.id,
          expectedVersion: cart.version - 1,
        },
        key(),
      ),
      "VERSION_CONFLICT",
    );
  });
  it("serializes competing option changes against the real cart lock", async () => {
    await stock(shop.lipRoyal.id);
    const third = await db().variant.create({
      data: {
        productId: shop.lipBrownie.productId,
        sku: "T-LIP-PEACH",
        attributes: { shade: "Peach" },
        priceRwf: 12000n,
        sortOrder: 2,
      },
    });
    await stock(third.id);
    const customer = await newCustomer();
    const cart = await addToCart(customer, shop.lipBrownie.id, 1);
    const results = await Promise.allSettled(
      [shop.lipRoyal.id, third.id].map((replacementVariantId) =>
        replaceCartLine(
          customer,
          {
            variantId: shop.lipBrownie.id,
            replacementVariantId,
            expectedVersion: cart.version,
          },
          key(),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    expect(failure.reason.code).toBe("VERSION_CONFLICT");
    expect((await getCartView(customer)).lines).toHaveLength(1);
  });
  it("invalidates a reviewed delivery quote after an option change", async () => {
    await stock(shop.lipRoyal.id);
    const customer = await newCustomer();
    const cart = await addToCart(customer, shop.lipBrownie.id, 1);
    const ready = await readyCheckout(customer);
    await replaceCartLine(
      customer,
      {
        variantId: shop.lipBrownie.id,
        replacementVariantId: shop.lipRoyal.id,
        expectedVersion: cart.version,
      },
      key(),
    );
    const checkout = await getCheckoutView(customer, ready.checkout.id);
    expect(checkout.state).toBe("EDITING");
    expect(checkout.quoteId).toBeNull();
    expect(checkout.revision).toBeGreaterThan(ready.checkout.revision);
    expect(
      (
        await db().deliveryQuote.findUniqueOrThrow({
          where: { id: ready.quote.id },
        })
      ).state,
    ).toBe("SUPERSEDED");
    await expectDomainError(pay(customer, ready), "VERSION_CONFLICT");
  });
  it("refuses changes while a payment is unresolved", async () => {
    await stock(shop.lipRoyal.id);
    const customer = await newCustomer();
    const cart = await addToCart(customer, shop.lipBrownie.id, 1);
    const ready = await readyCheckout(customer);
    await pay(customer, ready, { phone: PHONES.neverSettles });
    await expectDomainError(
      replaceCartLine(
        customer,
        {
          variantId: shop.lipBrownie.id,
          replacementVariantId: shop.lipRoyal.id,
          expectedVersion: cart.version,
        },
        key(),
      ),
      "PAYMENT_UNRESOLVED",
    );
    expect((await getCartView(customer)).lines[0]?.variantId).toBe(
      shop.lipBrownie.id,
    );
  });
  it("uses the real authenticated HTTP route and rejects extra request fields", async () => {
    await stock(shop.lipRoyal.id);
    const customer = await newCustomer();
    const cart = await addToCart(customer, shop.lipBrownie.id, 1);
    const call = (body: unknown) =>
      PATCH(
        new NextRequest(
          process.env.APP_ORIGIN + "/api/v1/cart/lines/" + shop.lipBrownie.id,
          {
            method: "PATCH",
            headers: {
              Origin: process.env.APP_ORIGIN!,
              "Content-Type": "application/json",
              "Idempotency-Key": key(),
              Cookie: GUEST_COOKIE + "=" + customer.token,
            },
            body: JSON.stringify(body),
          },
        ),
        { params: Promise.resolve({ variantId: shop.lipBrownie.id }) },
      );
    expect(
      (
        await call({
          expectedVersion: cart.version,
          replacementVariantId: shop.lipRoyal.id,
          quantity: 1,
        })
      ).status,
    ).toBe(422);
    const response = await call({
      expectedVersion: cart.version,
      replacementVariantId: shop.lipRoyal.id,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).lines[0].variantId).toBe(shop.lipRoyal.id);
  });
});
