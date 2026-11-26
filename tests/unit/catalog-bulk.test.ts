import { describe, expect, it } from "vitest";
import { preflightCatalogBatch, matchesConfirmedDraft, draftJournalKey } from "@/lib/catalog-bulk";
import type { StaffProductView } from "@/modules/catalog/admin";

const row = {
  slug: "her-majesty-ice-roller",
  title: "Ice Roller",
  brand: "Her Majesty Cosmetics",
  categorySlug: "skincare",
  description: "Ice Roller",
  photoFile: "HM-022.jpg",
  variants: [{ sku: "BB-HMC-0001", attributes: {}, priceRwf: 17510 }],
  contentReviewed: false,
  imageRightsConfirmed: false,
  hold: false,
};
const categories = [{ id: "category-1", slug: "skincare", title: "Skincare" }];
const files = [{ name: "HM-022.jpg", type: "image/jpeg", size: 1000 }];

describe("catalogue bulk preflight", () => {
  it("builds a verified draft without asserting review or referencing supplier URLs", () => {
    const result = preflightCatalogBatch({ version: 1, products: [row] }, files, categories);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toEqual([{
      title: "Ice Roller", slug: row.slug, brand: row.brand,
      categoryId: "category-1", description: "Ice Roller",
      variants: [{ id: null, sku: "BB-HMC-0001", attributes: {}, priceRwf: 17510, isActive: true }],
      media: [], contentReviewed: false, imageRightsConfirmed: false, isSynthetic: false,
    }]);
  });
  it("rejects duplicate SKUs and missing or remote photos before any upload", () => {
    const result = preflightCatalogBatch({ version: 1, products: [row, { ...row, slug: "another", photoFile: "https://example.com/photo.jpg" }] }, files, categories);
    expect(result.errors.join(" ")).toMatch(/duplicate sku|photoFile|duplicate/i);
    expect(result.drafts).toEqual([]);
  });
  it("keeps held entries in the batch but excludes them from writes", () => {
    const result = preflightCatalogBatch({ version: 1, products: [{ ...row, hold: true, holdReason: "Shade mismatch" }] }, [], categories);
    expect(result.errors).toEqual([]);
    expect(result.held).toEqual([row.slug]);
    expect(result.drafts).toEqual([]);
  });
  it("rejects a missing category and an unsafe photo type", () => {
    const result = preflightCatalogBatch({ version: 1, products: [row] }, [{ ...files[0]!, type: "image/svg+xml" }], []);
    expect(result.errors.join(" ")).toMatch(/category/i);
    expect(result.errors.join(" ")).toMatch(/photo/i);
  });
  it("rejects review assertions without meaningful content or a photo", () => {
    const result = preflightCatalogBatch({ version: 1, products: [{ ...row, description: "", contentReviewed: true }] }, [], categories);
    expect(result.errors.join(" ")).toMatch(/description|photo/i);
  });
  it("rejects attribute names and values the server would reject", () => {
    for (const attributes of [{ "shade-name": "Blue" }, { shade: " " }, { shade: "x".repeat(81) }]) {
      const candidate = { ...row, variants: [{ ...row.variants[0]!, attributes }] };
      const result = preflightCatalogBatch({ version: 1, products: [candidate] }, files, categories);
      expect(result.errors.join(" ")).toMatch(/attribute/i);
    }
  });
  it("normalizes whitespace before sending fields the server trims", () => {
    const result = preflightCatalogBatch({ version: 1, products: [{ ...row, title: " Ice Roller ", brand: " Her Majesty Cosmetics ", description: " Ice Roller " }] }, files, categories);
    expect(result.errors).toEqual([]);
    expect(result.drafts[0]).toMatchObject({ title: "Ice Roller", brand: "Her Majesty Cosmetics", description: "Ice Roller" });
  });
  it("keeps a product checkpoint stable when unrelated held rows change", async () => {
    const key = await draftJournalKey(draft, "HM-022.jpg", "photo-digest");
    expect(key).toBe(await draftJournalKey(draft, "HM-022.jpg", "photo-digest"));
    expect(key).not.toBe(await draftJournalKey({ ...draft, description: "changed" }, "HM-022.jpg", "photo-digest"));
    expect(key).not.toBe(await draftJournalKey(draft, "HM-022.jpg", "different-photo"));
  });
});

const draft = preflightCatalogBatch({ version: 1, products: [row] }, files, categories).drafts[0]!;
const saved = {
  isSynthetic: false, publishState: "DRAFT", product: { id: "product-1", slug: draft.slug, title: draft.title, brand: draft.brand, description: draft.description },
  categoryId: draft.categoryId, contentReviewed: false, imageRightsConfirmed: false,
  variants: [{ sku: "BB-HMC-0001", attributes: {}, priceRwf: 17510, isActive: true }],
  media: [{ storageKey: "beautybox-key-1", alt: "Ice Roller", variantId: null, sortOrder: 0, reviewState: "PENDING" }],
} as StaffProductView;

describe("confirmed catalogue resume", () => {
  it("rejects a published or review-changed record even with the same SKU", () => {
    const journal = { productId: "product-1", storageKey: "beautybox-key-1" };
    expect(matchesConfirmedDraft({ ...saved, publishState: "PUBLISHED" }, draft, journal)).toBe(false);
    expect(matchesConfirmedDraft({ ...saved, contentReviewed: true }, draft, journal)).toBe(false);
  });
  it("requires a journalled product and exact owned photo key", () => {
    expect(matchesConfirmedDraft(saved, draft, null)).toBe(false);
    expect(matchesConfirmedDraft(saved, draft, { productId: "product-1", storageKey: "other" })).toBe(false);
    expect(matchesConfirmedDraft(saved, draft, { productId: "product-1", storageKey: "beautybox-key-1" })).toBe(true);
  });
  it("matches JSONB attributes regardless of key order", () => {
    const multi = { ...draft, variants: [{ ...draft.variants[0]!, attributes: { shade: "Rose", finish: "Matte" } }] };
    const result = { ...saved, variants: [{ ...saved.variants[0]!, attributes: { finish: "Matte", shade: "Rose" } }] };
    expect(matchesConfirmedDraft(result, multi, { productId: "product-1", storageKey: "beautybox-key-1" })).toBe(true);
  });
  it("recovers a confirmed product from a checkpoint saved after photo finalization", () => {
    expect(matchesConfirmedDraft(saved, draft, { storageKey: "beautybox-key-1" })).toBe(true);
    expect(matchesConfirmedDraft(saved, draft, { storageKey: "other" })).toBe(false);
  });
});
