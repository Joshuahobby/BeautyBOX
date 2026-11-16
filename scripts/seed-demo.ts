// Demo catalog for LOCAL development only. Product names/prices for REF-01..08 come from
// the handoff's design references (Her Majesty Cosmetics, source-listed prices) and are
// flagged REFERENCE_DEMO; the rest are invented SYNTHETIC_DEMO items. None of this is
// confirmed BeautyBOX stock, pricing or photography, and the database refuses to publish
// it in production. No product photos are included (real SKU imagery is founder input B02).
import { db } from "@/server/db";
import { assertFixturesAllowed, createProduct, seedBaseConfiguration } from "@/modules/dev/fixtures";
import { createDemoCategories, createSyntheticProducts } from "@/modules/dev/synthetic-catalog";

const REFERENCE_NOTE =
  "Design reference product used to demonstrate the shopping journey. A verified description, usage and label information will replace this text before any real listing is published.";

async function main() {
  await assertFixturesAllowed();
  if ((await db().seller.count()) > 0) {
    console.log("[seed] demo data already present; run `npm run setup:local -- --reset` to start from empty");
    return;
  }
  const { seller, location } = await seedBaseConfiguration({ kigaliDelivery: true });
  const supplierA = await db().supplier.create({
    data: { name: "Demo supplier A (synthetic)", agreementReference: "DEMO-AGR-A", dataOrigin: "SYNTHETIC_DEMO" },
  });
  const supplierB = await db().supplier.create({
    data: { name: "Demo supplier B (synthetic)", agreementReference: "DEMO-AGR-B", dataOrigin: "SYNTHETIC_DEMO" },
  });

  await createDemoCategories();

  const base = { sellerId: seller.id, locationId: location.id };
  const ref = { ...base, brand: "Her Majesty Cosmetics", dataOrigin: "REFERENCE_DEMO" as const, description: REFERENCE_NOTE };

  await createProduct({
    ...ref, categorySlug: "cleansers", slug: "pure-zen-cleanser", title: "Pure Zen Cleanser",
    variants: [{ sku: "DEMO-REF01", priceRwf: 15000, lots: [
      { quantity: 6, expiryDate: "2027-09-30" },
      { quantity: 4, supplierId: supplierA.id, costBasisRwf: 9000, expiryDate: "2027-06-30" },
    ] }],
  });
  await createProduct({
    ...ref, categorySlug: "sun-care", slug: "radishield-sun-cream", title: "Radishield Sun Cream",
    variants: [{ sku: "DEMO-REF02", priceRwf: 15000, lots: [{ quantity: 5, expiryDate: "2027-12-31" }] }],
  });
  await createProduct({
    ...ref, categorySlug: "face", slug: "eternal-matteblend-foundation", title: "Eternal MatteBlend Foundation",
    packSize: "35 ml", optionLabel: "Shade",
    variants: [
      { sku: "DEMO-REF03-V80", attributes: { shade: "Deep Tan v80" }, priceRwf: 28000, lots: [{ quantity: 3 }] },
      { sku: "DEMO-REF03-V130", attributes: { shade: "Honey Bronze v130" }, priceRwf: 28000, lots: [] },
      { sku: "DEMO-REF03-V140", attributes: { shade: "Rich Caramel v140" }, priceRwf: 28000, lots: [{ quantity: 2, supplierId: supplierB.id }] },
    ],
  });
  const shades: [string, number][] = [
    ["Brownie", 4], ["Clarity", 2], ["Peachy", 3], ["Rosy", 1], ["Royal", 0], ["Rust", 2], ["Salmon", 5], ["Vermillion", 3],
  ];
  await createProduct({
    ...ref, categorySlug: "lips", slug: "lip-hue", title: "Lip Hue", packSize: "5 g", optionLabel: "Shade",
    variants: shades.map(([shade, qty]) => ({
      sku: `DEMO-REF04-${shade.toUpperCase()}`, attributes: { shade }, priceRwf: 12000,
      lots: qty > 0 ? [{ quantity: qty }] : [],
    })),
  });
  await createProduct({
    ...ref, categorySlug: "eyes", slug: "mascara-twinkle-lengthen", title: "Mascara Twinkle&Lengthen",
    variants: [{ sku: "DEMO-REF05", priceRwf: 9000, lots: [{ quantity: 8 }] }],
  });
  await createProduct({
    ...ref, categorySlug: "bath-body", slug: "rosewhisper-perspirant-roll-on", title: "Rosewhisper Perspirant Roll-on",
    packSize: "50 ml",
    variants: [{ sku: "DEMO-REF06", priceRwf: 7000, lots: [{ quantity: 6, supplierId: supplierB.id }] }],
  });
  await createProduct({
    ...ref, categorySlug: "fragrance", slug: "ember-perfume", title: "Ember Perfume", packSize: "50 ml",
    variants: [{ sku: "DEMO-REF07", priceRwf: 25000, lots: [] }],
  });
  await createProduct({
    ...ref, categorySlug: "tools-accessories", slug: "makeup-bag", title: "Makeup Bag",
    variants: [{ sku: "DEMO-REF08", priceRwf: 10000, lots: [{ quantity: 4 }] }],
  });

  await createSyntheticProducts(base);
  console.log(`[seed] demo catalog ready: ${await db().product.count()} products, ${await db().variant.count()} variants`);
}

main()
  .then(() => db().$disconnect())
  .catch(async (error) => {
    console.error("[seed] failed:", error instanceof Error ? error.message : error);
    await db().$disconnect();
    process.exit(1);
  });
