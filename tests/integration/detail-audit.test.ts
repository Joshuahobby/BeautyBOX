import { beforeEach, expect, it } from "vitest";
import { db } from "@/server/db";
import { listProducts } from "@/modules/catalog/catalog";
import { resetDatabase, seedShop, type Shop } from "./harness";

let shop: Shop;
beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
});

it("combines price and availability on the same variant, rather than different options", async () => {
  await db().variant.update({
    where: { id: shop.lipRoyal.id },
    data: { priceRwf: 5000n },
  });
  const filters = {
    q: "Test Lip",
    category: "makeup",
    brand: "Test Brand",
    maxPriceRwf: 6000,
  };
  expect((await listProducts(filters)).items.map((p) => p.slug)).toEqual([
    "test-lip",
  ]);
  expect(
    (await listProducts({ ...filters, availableOnly: true })).items,
  ).toEqual([]);
  expect(
    (
      await listProducts({
        ...filters,
        maxPriceRwf: 13000,
        availableOnly: true,
      })
    ).items.map((p) => p.slug),
  ).toEqual(["test-lip"]);
});

it("keeps unsupported delivery items out of homepage selection before pagination", async () => {
  const catalogue = await listProducts({ availableOnly: true });
  expect(catalogue.items.map((p) => p.slug)).toContain("bulky-item");

  const featured = await listProducts({
    availableOnly: true,
    standardDeliveryOnly: true,
    limit: 1,
    sort: "PRICE_DESC",
  });
  expect(featured.items).toHaveLength(1);
  expect(featured.items[0]!.slug).toBe("last-unit-serum");
  expect(featured.total).toBe(catalogue.total - 1);

  const rest = await listProducts({
    availableOnly: true,
    standardDeliveryOnly: true,
    cursor: featured.nextCursor,
    sort: "PRICE_DESC",
  });
  expect(rest.items.map((p) => p.slug)).not.toContain("bulky-item");
});

it("does not feature mixed delivery options, but ignores inactive unsupported options", async () => {
  await db().variant.update({
    where: { id: shop.lipRoyal.id },
    data: { parcelClass: "SPECIAL_HANDLING" },
  });
  const query = {
    q: "Test Lip",
    availableOnly: true,
    standardDeliveryOnly: true,
  };
  expect((await listProducts(query)).items).toEqual([]);

  await db().variant.update({
    where: { id: shop.lipRoyal.id },
    data: { isActive: false },
  });
  expect((await listProducts(query)).items.map((p) => p.slug)).toEqual([
    "test-lip",
  ]);
});
