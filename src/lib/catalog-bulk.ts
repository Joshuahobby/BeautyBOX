// Pure browser-side preflight for a staff catalogue batch. The manifest carries
// local photo names, never supplier URLs; all writes still use the audited staff APIs.
import type { StaffProductView } from "@/modules/catalog/admin";
export type CatalogBatchRow = {
  slug: string;
  title: string;
  brand: string;
  categorySlug: string;
  description: string;
  photoFile: string;
  variants: { sku: string; attributes: Record<string, string>; priceRwf: number }[];
  contentReviewed: boolean;
  imageRightsConfirmed: boolean;
  hold: boolean;
  holdReason?: string;
};
export type CatalogBatch = { version: 1; products: CatalogBatchRow[] };
export type CatalogDraft = {
  slug: string; title: string; brand: string; categoryId: string; description: string;
  variants: { id: null; sku: string; attributes: Record<string, string>; priceRwf: number; isActive: true }[];
  media: []; contentReviewed: boolean; imageRightsConfirmed: boolean; isSynthetic: false;
};
type Photo = { name: string; type: string; size: number };
type Category = { id: string; slug: string; title: string };
const photoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const skuPattern = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A per-product checkpoint survives edits to held or unrelated batch rows. */
export async function draftJournalKey(draft: CatalogDraft, photoName: string, photoDigest: string): Promise<string> {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) :
    object(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  const bytes = new TextEncoder().encode(JSON.stringify(canonical({ draft, photoName, photoDigest })));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `beautybox/catalog-bulk/v2/${draft.slug}/${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function preflightCatalogBatch(input: unknown, photos: Photo[], categories: Category[]) {
  const errors: string[] = [];
  const held: string[] = [];
  const drafts: CatalogDraft[] = [];
  if (!object(input) || input.version !== 1 || !Array.isArray(input.products) || input.products.length === 0 || input.products.length > 500) {
    return { errors: ["Expected a version 1 manifest with 1–500 products."], held, drafts };
  }
  if (/https?:\/\/|(?:source|supplier|remote)(?:_?url|_?image)/i.test(JSON.stringify(input))) {
    errors.push("Manifest must not contain supplier URLs or remote image references. Use local photo filenames.");
  }
  const fileNames = new Set<string>();
  for (const photo of photos) {
    if (fileNames.has(photo.name)) errors.push(`Duplicate photo filename: ${photo.name}`);
    fileNames.add(photo.name);
  }
  const files = new Map(photos.map((p) => [p.name, p]));
  const categoryIds = new Map(categories.map((c) => [c.slug, c.id]));
  const slugs = new Set<string>();
  const skus = new Set<string>();
  for (const [index, raw] of input.products.entries()) {
    if (!object(raw)) { errors.push(`Product ${index + 1}: expected an object.`); continue; }
    const label = typeof raw.slug === "string" ? raw.slug : `Product ${index + 1}`;
    if (typeof raw.slug !== "string" || raw.slug.length > 120 || !slugPattern.test(raw.slug)) errors.push(`${label}: invalid slug.`);
    if (slugs.has(label)) errors.push(`${label}: duplicate slug.`);
    slugs.add(label);
    if (typeof raw.hold !== "boolean" || typeof raw.contentReviewed !== "boolean" || typeof raw.imageRightsConfirmed !== "boolean") errors.push(`${label}: hold and review flags must be explicit booleans.`);
    if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 180) errors.push(`${label}: title required (max 180).`);
    if (typeof raw.brand !== "string" || !raw.brand.trim() || raw.brand.length > 120) errors.push(`${label}: brand required (max 120).`);
    if (typeof raw.description !== "string" || raw.description.length > 12000 || (raw.contentReviewed && !raw.description.trim())) errors.push(`${label}: reviewed description is missing or too long.`);
    if (typeof raw.categorySlug !== "string" || !categoryIds.has(raw.categorySlug)) errors.push(`${label}: unknown category.`);
    if (!Array.isArray(raw.variants) || raw.variants.length < 1 || raw.variants.length > 100) errors.push(`${label}: expected 1–100 variants.`);
    const variants: CatalogDraft["variants"] = [];
    if (Array.isArray(raw.variants)) for (const [variantIndex, value] of raw.variants.entries()) {
      if (!object(value)) { errors.push(`${label}: invalid variant ${variantIndex + 1}.`); continue; }
      const sku = value.sku;
      if (typeof sku !== "string" || !skuPattern.test(sku)) errors.push(`${label}: invalid SKU ${String(sku)}.`);
      if (typeof sku === "string" && skus.has(sku)) errors.push(`${label}: duplicate SKU ${sku}.`);
      if (typeof sku === "string") skus.add(sku);
      if (!Number.isSafeInteger(value.priceRwf) || (value.priceRwf as number) < 1) errors.push(`${label}: invalid RWF price.`);
      if (!object(value.attributes) || Object.entries(value.attributes).some(([key, val]) => !/^[a-z][a-zA-Z]{0,30}$/.test(key) || typeof val !== "string" || !val.trim() || val.length > 80)) errors.push(`${label}: variant attributes must have server-valid names and nonblank values of at most 80 characters.`);
      if (typeof sku === "string" && object(value.attributes) && Number.isSafeInteger(value.priceRwf)) variants.push({ id: null, sku, attributes: value.attributes as Record<string, string>, priceRwf: value.priceRwf as number, isActive: true });
    }
    if (raw.hold === true) {
      if (typeof raw.holdReason !== "string" || !raw.holdReason.trim()) errors.push(`${label}: held product needs a reason.`);
      held.push(label);
      continue;
    }
    const photo = typeof raw.photoFile === "string" ? files.get(raw.photoFile) : undefined;
    if (!photo || !photoTypes.has(photo.type) || !Number.isSafeInteger(photo.size) || photo.size < 1 || photo.size > 10_000_000) errors.push(`${label}: local photoFile is missing, invalid, or over 10 MB.`);
    if (typeof raw.photoFile !== "string" || raw.photoFile.includes("/") || raw.photoFile.includes("\\")) errors.push(`${label}: photoFile must be a plain filename.`);
    if (variants.length && typeof raw.slug === "string" && typeof raw.title === "string" && typeof raw.brand === "string" && typeof raw.description === "string" && typeof raw.categorySlug === "string") {
      drafts.push({ slug: raw.slug, title: raw.title.trim(), brand: raw.brand.trim(), categoryId: categoryIds.get(raw.categorySlug) ?? "", description: raw.description.trim(), variants, media: [], contentReviewed: raw.contentReviewed === true, imageRightsConfirmed: raw.imageRightsConfirmed === true, isSynthetic: false });
    }
  }
  if (errors.length) return { errors, held, drafts: [] as CatalogDraft[] };
  return { errors, held, drafts };
}

export type ConfirmedDraft = { productId?: string; storageKey: string; idempotencyKey?: string };
// A checkpoint written after photo finalization may also confirm a product whose
// create response was lost, but only when every server field and storage key match.
export function matchesConfirmedDraft(saved: StaffProductView, draft: CatalogDraft, confirmed: ConfirmedDraft | null): boolean {
  if (!confirmed?.storageKey || (confirmed.productId && saved.product.id !== confirmed.productId) || saved.publishState !== "DRAFT" || saved.isSynthetic ||
      saved.contentReviewed !== draft.contentReviewed || saved.imageRightsConfirmed !== draft.imageRightsConfirmed ||
      saved.product.slug !== draft.slug || saved.product.title !== draft.title || saved.product.brand !== draft.brand ||
      saved.product.description !== draft.description || saved.categoryId !== draft.categoryId) return false;
  if (saved.media.length !== 1 || saved.media[0]?.storageKey !== confirmed.storageKey ||
      saved.media[0].alt !== draft.title || saved.media[0].variantId !== null ||
      saved.media[0].sortOrder !== 0 ||
      saved.media[0].reviewState !== (draft.contentReviewed && draft.imageRightsConfirmed ? "APPROVED" : "PENDING")) return false;
  return saved.variants.length === draft.variants.length && draft.variants.every((variant) =>
    saved.variants.some((v) => v.sku === variant.sku && v.isActive && v.priceRwf === variant.priceRwf &&
      Object.keys(v.attributes).length === Object.keys(variant.attributes).length &&
      Object.entries(variant.attributes).every(([key, value]) => v.attributes[key] === value)));
}
