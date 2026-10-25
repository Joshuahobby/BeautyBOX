import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { seedBaseConfiguration } from "@/modules/dev/fixtures";
import { DEMO_CATEGORIES, ensureSyntheticCatalog, SYNTHETIC_ITEMS, SYNTHETIC_NOTE } from "@/modules/dev/synthetic-catalog";
import { resetDatabase } from "./harness";

// RF-88: the staging seed adds only what is missing, so an interrupted run is finished by the next.

beforeEach(async () => {
  await resetDatabase();
});

describe("staging synthetic catalog", () => {
  it("adds everything once, then nothing, and finishes a product an earlier run left half-made", async () => {
    const { seller, location } = await seedBaseConfiguration({ notificationsEnabled: false });
    const base = { sellerId: seller.id, locationId: location.id };
    // An interrupted earlier run: one category, and a product row without its variant or stock.
    await db().category.create({ data: { slug: "bath-body", title: "Bath & Body", isPublished: true } });
    const category = await db().category.findUniqueOrThrow({ where: { slug: "bath-body" } });
    await db().product.create({
      data: { sellerId: seller.id, categoryId: category.id, slug: "shea-body-butter", title: "Shea Body Butter", brand: "Sample Labs", description: SYNTHETIC_NOTE, dataOrigin: "SYNTHETIC_DEMO", publishState: "PUBLISHED", publishedAt: new Date(), contentReviewedAt: new Date() },
    });

    const first = await ensureSyntheticCatalog(base);
    expect(first).toEqual({ categoriesAdded: DEMO_CATEGORIES.length - 1, productsAdded: SYNTHETIC_ITEMS.length - 1, productsCompleted: 1 });
    const shea = await db().product.findUniqueOrThrow({ where: { slug: "shea-body-butter" }, include: { variants: { include: { lots: true } } } });
    expect(shea.variants).toHaveLength(1);
    expect(shea.variants[0]!.lots.reduce((n, l) => n + l.quantityOnHand, 0)).toBe(SYNTHETIC_ITEMS[0]!.qty);

    expect(await ensureSyntheticCatalog(base)).toEqual({ categoriesAdded: 0, productsAdded: 0, productsCompleted: 0 });
    expect(await db().product.count()).toBe(SYNTHETIC_ITEMS.length);
    expect(await db().variant.count()).toBe(SYNTHETIC_ITEMS.length);
    expect(await db().inventoryLot.count()).toBe(SYNTHETIC_ITEMS.filter((i) => i.qty > 0).length);
  });
});
