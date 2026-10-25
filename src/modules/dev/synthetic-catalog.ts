import "server-only";
import { db } from "@/server/db";
import { createCategory, createProduct, receiveStock } from "./fixtures";

// Invented SYNTHETIC_DEMO catalog shared by the local demo seed and the staging seed. None of
// it is BeautyBOX stock, pricing or a real brand; the database refuses to publish it in
// production.

export const SYNTHETIC_NOTE = "Synthetic demonstration product. It does not represent BeautyBOX stock, pricing or a real supplier.";

export const DEMO_CATEGORIES: [slug: string, title: string, parentSlug?: string][] = [
  ["skincare", "Skincare"],
  ["cleansers", "Cleansers", "skincare"],
  ["sun-care", "Sun Care", "skincare"],
  ["makeup", "Makeup"],
  ["face", "Face", "makeup"],
  ["lips", "Lips", "makeup"],
  ["eyes", "Eyes", "makeup"],
  ["bath-body", "Bath & Body"],
  ["fragrance", "Fragrance"],
  ["haircare", "Haircare"],
  ["tools-accessories", "Tools & Accessories"],
];

/** Synthetic items so the catalog exercises pagination (24 per page), filters and states. */
export const SYNTHETIC_ITEMS: { slug: string; title: string; category: string; price: number; qty: number; bulky?: boolean }[] = [
  { slug: "shea-body-butter", title: "Shea Body Butter", category: "bath-body", price: 8500, qty: 7 },
  { slug: "citrus-shower-gel", title: "Citrus Shower Gel", category: "bath-body", price: 6000, qty: 9 },
  { slug: "unscented-hand-cream", title: "Unscented Hand Cream", category: "bath-body", price: 5500, qty: 12 },
  { slug: "gentle-micellar-water", title: "Gentle Micellar Water", category: "cleansers", price: 11000, qty: 6 },
  { slug: "hydrating-face-mist", title: "Hydrating Face Mist", category: "skincare", price: 9500, qty: 4 },
  { slug: "daily-moisturiser", title: "Daily Moisturiser", category: "skincare", price: 16500, qty: 5 },
  { slug: "night-repair-cream", title: "Night Cream", category: "skincare", price: 21000, qty: 3 },
  { slug: "clay-face-mask", title: "Clay Face Mask", category: "skincare", price: 13000, qty: 0 },
  { slug: "brow-pencil", title: "Brow Pencil", category: "eyes", price: 6500, qty: 10 },
  { slug: "liquid-eyeliner", title: "Liquid Eyeliner", category: "eyes", price: 7500, qty: 8 },
  { slug: "setting-powder", title: "Setting Powder", category: "face", price: 14500, qty: 4 },
  { slug: "cream-blush", title: "Cream Blush", category: "face", price: 9000, qty: 6 },
  { slug: "lip-balm-trio", title: "Lip Balm Trio", category: "lips", price: 6500, qty: 9 },
  { slug: "gloss-clear", title: "Clear Lip Gloss", category: "lips", price: 7000, qty: 7 },
  { slug: "fresh-eau-de-toilette", title: "Fresh Eau de Toilette", category: "fragrance", price: 32000, qty: 2 },
  { slug: "body-mist-vanilla", title: "Vanilla Body Mist", category: "fragrance", price: 12000, qty: 5 },
  { slug: "leave-in-conditioner", title: "Leave-in Conditioner", category: "haircare", price: 10500, qty: 6 },
  { slug: "edge-control-gel", title: "Edge Control Gel", category: "haircare", price: 5000, qty: 11 },
  { slug: "detangling-comb", title: "Detangling Comb", category: "tools-accessories", price: 3000, qty: 15 },
  { slug: "makeup-sponge-pair", title: "Makeup Sponge Pair", category: "tools-accessories", price: 4000, qty: 14 },
  { slug: "salon-hood-dryer", title: "Salon Hood Dryer (special delivery)", category: "haircare", price: 185000, qty: 1, bulky: true },
];

export async function createDemoCategories() {
  for (const [i, [slug, title, parentSlug]] of DEMO_CATEGORIES.entries()) {
    await createCategory({ slug, title, parentSlug, sortOrder: i });
  }
}

export async function createSyntheticProducts(base: { sellerId: string; locationId: string }) {
  for (const [i, item] of SYNTHETIC_ITEMS.entries()) {
    await createProduct({
      ...base,
      brand: "Sample Labs",
      dataOrigin: "SYNTHETIC_DEMO",
      description: SYNTHETIC_NOTE,
      categorySlug: item.category,
      slug: item.slug,
      title: item.title,
      variants: [
        {
          sku: `DEMO-SYN-${String(i + 1).padStart(2, "0")}`,
          priceRwf: item.price,
          parcelClass: item.bulky ? "BULKY" : "STANDARD",
          lots: item.qty > 0 ? [{ quantity: item.qty }] : [],
        },
      ],
    });
  }
}

/**
 * Staging seed (DR-044): adds whatever of the synthetic catalog is missing, so a run that was
 * interrupted part-way is finished by the next one instead of being reported as done.
 */
export async function ensureSyntheticCatalog(base: { sellerId: string; locationId: string }): Promise<{ categoriesAdded: number; productsAdded: number; productsCompleted: number }> {
  let categoriesAdded = 0;
  for (const [i, [slug, title, parentSlug]] of DEMO_CATEGORIES.entries()) {
    if (await db().category.findUnique({ where: { slug } })) continue;
    await createCategory({ slug, title, parentSlug, sortOrder: i });
    categoriesAdded++;
  }
  let productsAdded = 0;
  let productsCompleted = 0;
  for (const [i, item] of SYNTHETIC_ITEMS.entries()) {
    const sku = `DEMO-SYN-${String(i + 1).padStart(2, "0")}`;
    const existing = await db().product.findUnique({ where: { slug: item.slug }, include: { variants: { include: { lots: true } } } });
    if (!existing) {
      await createProduct({
        ...base,
        brand: "Sample Labs",
        dataOrigin: "SYNTHETIC_DEMO",
        description: SYNTHETIC_NOTE,
        categorySlug: item.category,
        slug: item.slug,
        title: item.title,
        variants: [{ sku, priceRwf: item.price, parcelClass: item.bulky ? "BULKY" : "STANDARD", lots: item.qty > 0 ? [{ quantity: item.qty }] : [] }],
      });
      productsAdded++;
      continue;
    }
    // A product row without its variant or its stock: finish what the earlier run started.
    let variant = existing.variants.find((v) => v.sku === sku) ?? null;
    let completed = false;
    if (!variant) {
      variant = { ...(await db().variant.create({ data: { productId: existing.id, sku, attributes: {}, priceRwf: BigInt(item.price), parcelClass: item.bulky ? "BULKY" : "STANDARD", sortOrder: 0 } })), lots: [] };
      completed = true;
    }
    if (item.qty > 0 && variant.lots.length === 0) {
      await receiveStock({
        variantId: variant.id,
        locationId: base.locationId,
        quantity: item.qty,
        ownership: "OWNED",
        supplierId: null,
        costBasisRwf: null,
        expiryDate: null,
        batchReference: `${sku}-LOT-1`,
        dataOrigin: "SYNTHETIC_DEMO",
      });
      completed = true;
    }
    if (completed) productsCompleted++;
  }
  return { categoriesAdded, productsAdded, productsCompleted };
}
