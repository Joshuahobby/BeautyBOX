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
