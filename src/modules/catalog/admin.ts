import "server-only";
import { z } from "@/lib/validation";
import { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Tx } from "@/server/db";
import { now } from "@/modules/shared/clock";
import { DomainError, notFound } from "@/modules/shared/errors";
import { toRwf } from "@/modules/shared/money";
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from "@/modules/idempotency/idempotency";
import { audit } from "@/modules/audit/audit";
import { currentSettings, kigaliToday } from "@/modules/settings/settings";
import type { StaffIdentity } from "@/modules/staff/identity";
import { enqueuePublicSync, ensurePublicCopies, syncPublicCopiesNow } from "@/modules/media/publication";
import { staffMediaUrl } from "./media";

// Staff catalog editing (A04, CAT-01..03, API "Admin publication and configuration").
// Writes start as drafts; publication is recomputed from server state on every read and
// write. Synthetic/reference records can never be published through this path (T23).

export type DraftVariantInput = { id: string | null; sku: string; attributes: Record<string, string>; priceRwf: number; isActive: boolean };
export type DraftMediaInput = { storageKey: string; alt: string; variantId: string | null; sortOrder: number };
export type ProductDraftInput = {
  title: string;
  slug: string;
  brand: string;
  categoryId: string;
  description: string;
  variants: DraftVariantInput[];
  media: DraftMediaInput[];
  contentReviewed: boolean;
  imageRightsConfirmed: boolean;
  isSynthetic: boolean;
};

export type PublicationError =
  | "SYNTHETIC_RECORD"
  | "CONTENT_NOT_REVIEWED"
  | "DESCRIPTION_MISSING"
  | "IMAGE_RIGHTS_NOT_CONFIRMED"
  | "NO_APPROVED_PHOTO"
  | "NO_ACTIVE_VARIANT"
  | "NO_VERIFIED_STOCK"
  | "CATEGORY_UNPUBLISHED";

export type StaffProductView = {
  product: {
    id: string;
    slug: string;
    title: string;
    brand: string;
    categorySlug: string;
    categoryTitle: string;
    description: string;
    packSize: string | null;
    optionLabel: string | null;
    isDemo: boolean;
    images: { url: string; alt: string }[];
    variants: { id: string; sku: string; attributes: Record<string, string>; priceRwf: number; isAvailable: boolean; imageUrl: string | null }[];
  };
  version: number;
  publishState: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publicationErrors: PublicationError[];
  // Additions (CC-15): editing context
  categoryId: string;
  isSynthetic: boolean;
  contentReviewed: boolean;
  imageRightsConfirmed: boolean;
  variants: { id: string; sku: string; attributes: Record<string, string>; priceRwf: number; isActive: boolean; available: number }[];
  media: { storageKey: string; alt: string; variantId: string | null; sortOrder: number; reviewState: string; url: string }[];
};

const SKU = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateDraft(input: ProductDraftInput) {
  const errors: { field: string; message: string }[] = [];
  if (!input.title.trim() || input.title.length > 180) errors.push({ field: "title", message: "Enter a title of up to 180 characters." });
  if (!SLUG.test(input.slug) || input.slug.length > 120) errors.push({ field: "slug", message: "Use lowercase letters, numbers and single hyphens." });
  if (!input.brand.trim() || input.brand.length > 120) errors.push({ field: "brand", message: "Enter the brand." });
  if (input.description.length > 12000) errors.push({ field: "description", message: "Keep the description under 12,000 characters." });
  if (input.variants.length === 0 || input.variants.length > 100) errors.push({ field: "variants", message: "Add between 1 and 100 variants." });
  const skus = new Set<string>();
  input.variants.forEach((v, i) => {
    const sku = v.sku.trim().toUpperCase();
    if (!SKU.test(sku)) errors.push({ field: `variants.${i}.sku`, message: "SKU: 2-64 letters, digits, dot, dash or underscore." });
    if (skus.has(sku)) errors.push({ field: `variants.${i}.sku`, message: "Duplicate SKU in this product." });
    skus.add(sku);
    if (!Number.isSafeInteger(v.priceRwf) || v.priceRwf < 1) errors.push({ field: `variants.${i}.priceRwf`, message: "Price must be a whole, positive RWF amount." });
    for (const [k, val] of Object.entries(v.attributes)) {
      if (!/^[a-z][a-zA-Z]{0,30}$/.test(k) || typeof val !== "string" || !val.trim() || val.length > 80) {
        errors.push({ field: `variants.${i}.attributes`, message: "Attributes need a short name and a value." });
      }
    }
  });
  input.media.forEach((m, i) => {
    if (!m.alt.trim() || m.alt.length > 240) errors.push({ field: `media.${i}.alt`, message: "Describe the photo (up to 240 characters)." });
  });
  if (errors.length > 0) throw new DomainError("VALIDATION_ERROR", "Check the highlighted product details.", { fieldErrors: errors });
}

async function sellableVerifiedStock(client: Tx | ReturnType<typeof db>, variantIds: string[]): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const settings = await currentSettings(client);
  const rows = await client.$queryRaw<{ variant_id: string; available: bigint }[]>`
    SELECT l.variant_id, SUM(l.quantity_on_hand - l.reserved_qty - l.committed_qty) AS available
      FROM commerce.inventory_lots l
     WHERE l.variant_id IN (${Prisma.join(variantIds.map((id) => Prisma.sql`${id}::uuid`))})
       AND l.is_active AND l.review_state = 'VERIFIED' AND l.data_origin = 'VERIFIED'
       AND l.location_id = ${settings.activeLocationId}::uuid
       AND (l.expiry_date IS NULL OR l.expiry_date > ${kigaliToday(now())}::date)
     GROUP BY l.variant_id`;
  return new Map(rows.map((r) => [r.variant_id, Math.max(0, Number(r.available))]));
}

async function loadStaffProduct(client: Tx | ReturnType<typeof db>, productId: string): Promise<StaffProductView> {
  const p = await client.product.findUnique({
    where: { id: productId },
    include: { category: true, variants: { orderBy: [{ sortOrder: "asc" }, { sku: "asc" }] }, media: { orderBy: { sortOrder: "asc" } } },
  });
  if (!p) throw notFound();
  const stock = await sellableVerifiedStock(client, p.variants.map((v) => v.id));
  const errors: PublicationError[] = [];
  if (p.dataOrigin !== "VERIFIED") errors.push("SYNTHETIC_RECORD");
  if (!p.contentReviewedAt) errors.push("CONTENT_NOT_REVIEWED");
  if (!p.description.trim()) errors.push("DESCRIPTION_MISSING");
  if (!p.imageRightsConfirmedAt) errors.push("IMAGE_RIGHTS_NOT_CONFIRMED");
  if (!p.media.some((m) => m.reviewState === "APPROVED")) errors.push("NO_APPROVED_PHOTO");
  const active = p.variants.filter((v) => v.isActive);
  if (active.length === 0) errors.push("NO_ACTIVE_VARIANT");
  if (!active.some((v) => (stock.get(v.id) ?? 0) > 0)) errors.push("NO_VERIFIED_STOCK");
  if (!p.category.isPublished) errors.push("CATEGORY_UNPUBLISHED");
  const approved = p.media.filter((m) => m.reviewState === "APPROVED");
  return {
    product: {
      id: p.id,
      slug: p.slug,
      title: p.title,
      brand: p.brand,
      categorySlug: p.category.slug,
      categoryTitle: p.category.title,
      description: p.description,
      packSize: p.packSize,
      optionLabel: p.optionLabel,
      isDemo: p.dataOrigin !== "VERIFIED",
      images: approved.filter((m) => !m.variantId).map((m) => ({ url: staffMediaUrl(m.storageKey), alt: m.alt })),
      variants: active.map((v) => {
        const img = approved.find((m) => m.variantId === v.id);
        return {
          id: v.id,
          sku: v.sku,
          attributes: v.attributes as Record<string, string>,
          priceRwf: toRwf(v.priceRwf),
          isAvailable: (stock.get(v.id) ?? 0) > 0,
          imageUrl: img ? staffMediaUrl(img.storageKey) : null,
        };
      }),
    },
    version: p.version,
    publishState: p.publishState,
    publicationErrors: errors,
    categoryId: p.categoryId,
    isSynthetic: p.dataOrigin !== "VERIFIED",
    contentReviewed: p.contentReviewedAt !== null,
    imageRightsConfirmed: p.imageRightsConfirmedAt !== null,
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      attributes: v.attributes as Record<string, string>,
      priceRwf: toRwf(v.priceRwf),
      isActive: v.isActive,
      available: stock.get(v.id) ?? 0,
    })),
    media: p.media
      .filter((m) => m.reviewState !== "REJECTED")
      .map((m) => ({ storageKey: m.storageKey, alt: m.alt, variantId: m.variantId, sortOrder: m.sortOrder, reviewState: m.reviewState, url: staffMediaUrl(m.storageKey) })),
  };
}

export const getStaffProduct = (productId: string) => loadStaffProduct(db(), productId);

export async function listStaffProducts(input: { limit?: number; cursor?: string | null }) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const rows = await db().product.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: limit + 1,
    select: { id: true },
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const items = [];
  for (const r of rows.slice(0, limit)) items.push(await loadStaffProduct(db(), r.id));
  return { items, nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
}

async function assertMediaUsable(tx: Tx, productId: string, media: DraftMediaInput[]) {
  for (const [i, m] of media.entries()) {
    const upload = await tx.mediaUpload.findUnique({ where: { storageKey: m.storageKey } });
    if (!upload || upload.state !== "FINALIZED" || upload.purpose !== "PRODUCT_PHOTO") {
      throw new DomainError("VALIDATION_ERROR", "Use only finalised product photos.", {
        fieldErrors: [{ field: `media.${i}.storageKey`, message: "Upload and finalise this photo first." }],
      });
    }
    // A photo belongs to one product: reusing it elsewhere would rewrite that product's photo.
    const owner = await tx.productMedia.findUnique({ where: { storageKey: m.storageKey }, select: { productId: true } });
    if (owner && owner.productId !== productId) {
      throw new DomainError("VALIDATION_ERROR", "This photo belongs to another product. Upload it again for this one.", {
        fieldErrors: [{ field: `media.${i}.storageKey`, message: "Photo belongs to another product." }],
      });
    }
  }
}

/** Writes variants and photos; returns the photos whose public copy must change (DR-041). */
async function writeVariantsAndMedia(tx: Tx, productId: string, input: ProductDraftInput, existingIds: Set<string>): Promise<string[]> {
  const keep = new Set<string>();
  for (const [i, draftVariant] of input.variants.entries()) {
    let v = draftVariant;
    const sku = v.sku.trim().toUpperCase();
    const clash = await tx.variant.findUnique({ where: { sku } });
    // A variant of this product sent without its id is the same variant (matched by SKU).
    if (clash && !v.id && clash.productId === productId && !keep.has(clash.id)) v = { ...v, id: clash.id };
    if (clash && clash.id !== v.id) {
      throw new DomainError("VALIDATION_ERROR", "This SKU is already used by another product.", {
        fieldErrors: [{ field: `variants.${i}.sku`, message: "SKU already exists." }],
      });
    }
    if (v.id) {
      if (!existingIds.has(v.id)) throw new DomainError("VALIDATION_ERROR", "Unknown variant.", { fieldErrors: [{ field: `variants.${i}.id`, message: "Unknown variant." }] });
      const current = await tx.variant.findUniqueOrThrow({ where: { id: v.id } });
      if (current.sku !== sku) {
        const used = (await tx.inventoryLot.count({ where: { variantId: v.id } })) + (await tx.orderLine.count({ where: { variantId: v.id } }));
        if (used > 0) {
          throw new DomainError("VALIDATION_ERROR", "A SKU with stock or orders cannot be renamed.", { fieldErrors: [{ field: `variants.${i}.sku`, message: "SKU is in use." }] });
        }
      }
      const priceChanged = Number(current.priceRwf) !== v.priceRwf;
      await tx.variant.update({
        where: { id: v.id },
        data: {
          sku,
          attributes: v.attributes,
          priceRwf: BigInt(v.priceRwf),
          isActive: v.isActive,
          sortOrder: i,
          version: { increment: 1 },
          ...(priceChanged ? { priceVersion: { increment: 1 } } : {}),
        },
      });
      keep.add(v.id);
    } else {
      const created = await tx.variant.create({
        data: { productId, sku, attributes: v.attributes, priceRwf: BigInt(v.priceRwf), isActive: v.isActive, sortOrder: i },
      });
      keep.add(created.id);
    }
  }
  // Variants missing from the draft are deactivated, never deleted (order history).
  for (const id of existingIds) {
    if (!keep.has(id)) await tx.variant.update({ where: { id }, data: { isActive: false, version: { increment: 1 } } });
  }
  const keys = input.media.map((m) => m.storageKey);
  // Lock this product's photo rows (and any row for an incoming key) so the review state
  // read below is the one this save replaces.
  await tx.$queryRaw`SELECT id FROM commerce.product_media WHERE product_id = ${productId}::uuid OR storage_key = ANY(${keys}::text[]) FOR UPDATE`;
  await assertMediaUsable(tx, productId, input.media);
  const approved = input.imageRightsConfirmed && input.contentReviewed;
  // Review state before this save, for every photo it can touch.
  const prior = await tx.productMedia.findMany({ where: { OR: [{ productId }, { storageKey: { in: keys } }] }, select: { storageKey: true, reviewState: true } });
  const wasApproved = new Set(prior.filter((m) => m.reviewState === "APPROVED").map((m) => m.storageKey));
  const changed: { id: string; storageKey: string }[] = [];
  for (const m of input.media) {
    if (m.variantId && !keep.has(m.variantId)) throw new DomainError("VALIDATION_ERROR", "Photo linked to an unknown variant.");
    const upload = await tx.mediaUpload.findUniqueOrThrow({ where: { storageKey: m.storageKey } });
    const row = await tx.productMedia.upsert({
      where: { storageKey: m.storageKey },
      create: {
        productId, variantId: m.variantId, storageKey: m.storageKey, alt: m.alt.trim(), sortOrder: m.sortOrder,
        width: upload.width ?? 0, height: upload.height ?? 0, reviewState: approved ? "APPROVED" : "PENDING",
      },
      update: { variantId: m.variantId, alt: m.alt.trim(), sortOrder: m.sortOrder, reviewState: approved ? "APPROVED" : "PENDING" },
    });
    if (wasApproved.has(m.storageKey) !== approved) changed.push({ id: row.id, storageKey: m.storageKey });
  }
  // Photos removed from the draft stop being shown (rows stay for history), and lose
  // their public copy if they had one.
  const removed = await tx.productMedia.findMany({ where: { productId, storageKey: { notIn: keys }, reviewState: "APPROVED" }, select: { id: true, storageKey: true } });
  await tx.productMedia.updateMany({
    where: { productId, storageKey: { notIn: keys } },
    data: { reviewState: "REJECTED" },
  });
  changed.push(...removed);
  for (const c of changed) await enqueuePublicSync(tx, c.id, c.storageKey);
  return changed.map((c) => c.storageKey);
}

export async function createProductDraft(staff: StaffIdentity, input: ProductDraftInput, idempotencyKey: string, requestId: string | null): Promise<StaffProductView> {
  validateDraft(input);
  let publicChanges: string[] = [];
  const id = await transaction(async (tx) => {
    publicChanges = [];
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:product-create`, key: idempotencyKey, requestHash: requestHash("createProductDraft", input) });
    if (claim.kind === "REPLAY") return claim.resourceId;
    const category = await tx.category.findUnique({ where: { id: input.categoryId } });
    if (!category) throw new DomainError("VALIDATION_ERROR", "Choose a category.", { fieldErrors: [{ field: "categoryId", message: "Unknown category." }] });
    if (await tx.product.findUnique({ where: { slug: input.slug } })) {
      throw new DomainError("VALIDATION_ERROR", "This web address is already used.", { fieldErrors: [{ field: "slug", message: "Slug already exists." }] });
    }
    const settings = await currentSettings(tx);
    const location = await tx.dispatchLocation.findUniqueOrThrow({ where: { id: settings.activeLocationId } });
    const at = now();
    const product = await tx.product.create({
      data: {
        sellerId: location.sellerId,
        categoryId: input.categoryId,
        slug: input.slug,
        brand: input.brand.trim(),
        title: input.title.trim(),
        description: input.description.trim(),
        dataOrigin: input.isSynthetic ? "SYNTHETIC_DEMO" : "VERIFIED",
        publishState: "DRAFT",
        contentReviewedAt: input.contentReviewed ? at : null,
        contentReviewedBy: input.contentReviewed ? staff.staffId : null,
        imageRightsConfirmedAt: input.imageRightsConfirmed ? at : null,
        imageRightsConfirmedBy: input.imageRightsConfirmed ? staff.staffId : null,
      },
    });
    publicChanges = await writeVariantsAndMedia(tx, product.id, input, new Set());
    await audit(tx, { actor: { type: "STAFF", id: staff.staffId }, entityType: "product", entityId: product.id, action: "PRODUCT_DRAFT_CREATED", after: { slug: product.slug, variants: input.variants.length }, requestId });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "product", resourceId: product.id, responseStatus: 201 });
    return product.id;
  });
  await syncPublicCopiesNow(publicChanges);
  return getStaffProduct(id);
}

export async function replaceProductDraft(
  staff: StaffIdentity,
  productId: string,
  body: { expectedVersion: number; draft: ProductDraftInput },
  idempotencyKey: string,
  requestId: string | null,
): Promise<StaffProductView> {
  const input = body.draft;
  validateDraft(input);
  let publicChanges: string[] = [];
  await transaction(async (tx) => {
    publicChanges = [];
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:product-replace:${productId}`, key: idempotencyKey, requestHash: requestHash("replaceProductDraft", body) });
    if (claim.kind === "REPLAY") return;
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM commerce.products WHERE id = ${productId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw notFound();
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, include: { variants: { select: { id: true } } } });
    if (product.version !== body.expectedVersion) throw new DomainError("VERSION_CONFLICT", "This product changed while you were editing. Reload to see the latest version.");
    if (product.publishState === "ARCHIVED") throw new DomainError("ACTION_NOT_ALLOWED", "Archived products cannot be edited.");
    if (input.slug !== product.slug && (await tx.product.findUnique({ where: { slug: input.slug } }))) {
      throw new DomainError("VALIDATION_ERROR", "This web address is already used.", { fieldErrors: [{ field: "slug", message: "Slug already exists." }] });
    }
    if (!(await tx.category.findUnique({ where: { id: input.categoryId } }))) {
      throw new DomainError("VALIDATION_ERROR", "Choose a category.", { fieldErrors: [{ field: "categoryId", message: "Unknown category." }] });
    }
    if (product.dataOrigin !== "VERIFIED" && !input.isSynthetic) {
      // A synthetic record cannot be relabelled as verified business data.
      throw new DomainError("ACTION_NOT_ALLOWED", "Synthetic or reference records cannot become verified products. Create a new product from verified information.");
    }
    const at = now();
    await tx.product.update({
      where: { id: productId },
      data: {
        categoryId: input.categoryId,
        slug: input.slug,
        brand: input.brand.trim(),
        title: input.title.trim(),
        description: input.description.trim(),
        dataOrigin: input.isSynthetic ? (product.dataOrigin === "VERIFIED" ? "SYNTHETIC_DEMO" : product.dataOrigin) : "VERIFIED",
        contentVersion: { increment: 1 },
        version: { increment: 1 },
        contentReviewedAt: input.contentReviewed ? (product.contentReviewedAt ?? at) : null,
        contentReviewedBy: input.contentReviewed ? (product.contentReviewedBy ?? staff.staffId) : null,
        imageRightsConfirmedAt: input.imageRightsConfirmed ? (product.imageRightsConfirmedAt ?? at) : null,
        imageRightsConfirmedBy: input.imageRightsConfirmed ? (product.imageRightsConfirmedBy ?? staff.staffId) : null,
      },
    });
    publicChanges = await writeVariantsAndMedia(tx, productId, input, new Set(product.variants.map((v) => v.id)));
    // A published product whose content no longer passes the checks goes back to draft.
    if (product.publishState === "PUBLISHED") {
      const after = await loadStaffProduct(tx, productId);
      if (after.publicationErrors.length > 0) {
        await tx.product.update({ where: { id: productId }, data: { publishState: "DRAFT", version: { increment: 1 } } });
        await audit(tx, { actor: { type: "STAFF", id: staff.staffId }, entityType: "product", entityId: productId, action: "PRODUCT_UNPUBLISHED_BY_EDIT", after: { errors: after.publicationErrors }, requestId });
      }
    }
    await audit(tx, { actor: { type: "STAFF", id: staff.staffId }, entityType: "product", entityId: productId, action: "PRODUCT_DRAFT_REPLACED", after: { variants: input.variants.length }, requestId });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "product", resourceId: productId, responseStatus: 200 });
  });
  await syncPublicCopiesNow(publicChanges);
  return getStaffProduct(productId);
}

export async function setPublication(
  staff: StaffIdentity,
  productId: string,
  body: { expectedVersion: number; state: "PUBLISHED" | "ARCHIVED"; reason: string },
  idempotencyKey: string,
  requestId: string | null,
): Promise<StaffProductView> {
  if (!body.reason.trim()) throw new DomainError("VALIDATION_ERROR", "Give a reason.", { fieldErrors: [{ field: "reason", message: "Required." }] });
  if (body.state === "PUBLISHED") {
    // Publishing a product must not show customers missing photos (DR-041). (An archived
    // product's photos are made public right after the commit instead, see below.)
    try {
      await ensurePublicCopies(productId);
    } catch {
      throw new DomainError("PROVIDER_UNAVAILABLE", "The product photos could not be made public right now. Nothing was published; try again shortly.");
    }
  }
  let publicChanges: string[] = [];
  await transaction(async (tx) => {
    publicChanges = [];
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:publication:${productId}`, key: idempotencyKey, requestHash: requestHash("setPublication", body) });
    if (claim.kind === "REPLAY") return;
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM commerce.products WHERE id = ${productId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw notFound();
    const view = await loadStaffProduct(tx, productId);
    if (view.version !== body.expectedVersion) throw new DomainError("VERSION_CONFLICT", "This product changed. Reload to review the latest version.");
    if (body.state === "PUBLISHED" && view.publicationErrors.length > 0) {
      throw new DomainError("PUBLICATION_BLOCKED", "This product cannot be published yet.", {
        fieldErrors: view.publicationErrors.map((e) => ({ field: "publication", message: e })),
      });
    }
    const at = now();
    await tx.product.update({
      where: { id: productId },
      data: { publishState: body.state, version: { increment: 1 }, publishedAt: body.state === "PUBLISHED" ? at : undefined },
    });
    // Archiving withdraws the public copies of the product's photos; leaving the archive
    // restores them (a photo is public only while approved and its product not archived).
    if ((view.publishState === "ARCHIVED") !== (body.state === "ARCHIVED")) {
      const photos = await tx.productMedia.findMany({ where: { productId, reviewState: "APPROVED" }, select: { id: true, storageKey: true } });
      for (const p of photos) await enqueuePublicSync(tx, p.id, p.storageKey);
      publicChanges = photos.map((p) => p.storageKey);
    }
    await audit(tx, {
      actor: { type: "STAFF", id: staff.staffId },
      entityType: "product",
      entityId: productId,
      action: body.state === "PUBLISHED" ? "PRODUCT_PUBLISHED" : "PRODUCT_ARCHIVED",
      before: { publishState: view.publishState },
      after: { publishState: body.state },
      reason: body.reason.trim(),
      requestId,
    });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "product", resourceId: productId, responseStatus: 200 });
  });
  await syncPublicCopiesNow(publicChanges);
  return getStaffProduct(productId);
}

export async function listCategoriesForStaff() {
  return db().category.findMany({ orderBy: [{ sortOrder: "asc" }, { title: "asc" }], select: { id: true, slug: true, title: true, parentId: true, isPublished: true } });
}

/** Bulk publication change across many products. One result per product id. */
export type BulkPublicationResult =
  | { productId: string; ok: true; publishState: "PUBLISHED" | "ARCHIVED" }
  | { productId: string; ok: false; code: string; message: string; fieldErrors: { field: string; message: string }[] };

export async function bulkSetPublication(
  staff: StaffIdentity,
  input: { productIds: string[]; state: "PUBLISHED" | "ARCHIVED"; reason: string },
  idempotencyKey: string,
  requestId: string | null,
): Promise<BulkPublicationResult[]> {
  const results: BulkPublicationResult[] = [];
  for (const productId of input.productIds) {
    if (!z.uuid().safeParse(productId).success) {
      results.push({ productId, ok: false, code: "VALIDATION_ERROR", message: "Invalid product ID.", fieldErrors: [] });
      continue;
    }
    try {
      const view = await loadStaffProduct(db(), productId);
      await setPublication(staff, productId, { expectedVersion: view.version, state: input.state, reason: input.reason }, idempotencyKey, requestId);
      results.push({ productId, ok: true, publishState: input.state });
    } catch (error) {
      if (error instanceof DomainError) {
        results.push({ productId, ok: false, code: error.code, message: error.message, fieldErrors: error.fieldErrors ?? [] });
      } else {
        results.push({ productId, ok: false, code: "INTERNAL_ERROR", message: "Unexpected error.", fieldErrors: [] });
      }
    }
  }
  return results;
}
