import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { now } from "@/modules/shared/clock";
import { toRwf } from "@/modules/shared/money";
import { DomainError } from "@/modules/shared/errors";
import { currentSettings, kigaliToday } from "@/modules/settings/settings";
import {
  sellableLotCondition,
  visibleProductCondition,
  type StockScope,
} from "@/modules/inventory/eligibility";
import { mediaUrl } from "./media";

// Public catalog reads (FSD CAT-01..04). Only published, visible products; prices
// and availability are discovery snapshots. Every cart/checkout write revalidates.

export type PublicVariant = {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  priceRwf: number;
  isAvailable: boolean;
  imageUrl: string | null;
};

export type PublicProduct = {
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
  variants: PublicVariant[];
};

export type PublicCategory = {
  id: string;
  slug: string;
  title: string;
  parentId: string | null;
};

export type ProductSort = "RELEVANCE" | "PRICE_ASC" | "PRICE_DESC" | "NEWEST";

export type ProductQuery = {
  q?: string;
  category?: string;
  brand?: string;
  minPriceRwf?: number;
  maxPriceRwf?: number;
  availableOnly?: boolean;
  sort?: ProductSort;
  limit?: number;
  cursor?: string | null;
};

export const DEFAULT_PAGE_SIZE = 24;

export async function stockScope(): Promise<StockScope> {
  const settings = await currentSettings();
  return {
    locationId: settings.activeLocationId,
    todayKigali: kigaliToday(now()),
  };
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { o?: unknown };
    if (
      typeof parsed.o === "number" &&
      Number.isSafeInteger(parsed.o) &&
      parsed.o >= 0 &&
      parsed.o <= 100_000
    ) {
      return parsed.o;
    }
  } catch {
    // fall through
  }
  throw new DomainError("VALIDATION_ERROR", "Invalid page cursor.", {
    httpStatus: 400,
  });
}

const encodeCursor = (offset: number) =>
  Buffer.from(JSON.stringify({ o: offset })).toString("base64url");

function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function listProducts(
  query: ProductQuery,
): Promise<{
  items: PublicProduct[];
  nextCursor: string | null;
  total: number;
}> {
  const scope = await stockScope();
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
  const offset = decodeCursor(query.cursor);
  const q = query.q?.trim().toLowerCase().slice(0, 100) ?? "";
  const like = `%${escapeLike(q)}%`;

  const where: Prisma.Sql[] = [visibleProductCondition("p")];
  if (q) {
    where.push(Prisma.sql`(lower(p.title) LIKE ${like} OR lower(p.brand) LIKE ${like} OR lower(c.title) LIKE ${like}
      OR lower(coalesce(pc.title, '')) LIKE ${like})`);
  }
  if (query.category) {
    where.push(
      Prisma.sql`(c.slug = ${query.category} OR pc.slug = ${query.category})`,
    );
  }
  if (query.brand)
    where.push(Prisma.sql`lower(p.brand) = ${query.brand.toLowerCase()}`);
  const min = query.minPriceRwf ?? null;
  const max = query.maxPriceRwf ?? null;
  if (min !== null || max !== null) {
    where.push(Prisma.sql`EXISTS (SELECT 1 FROM commerce.variants pv WHERE pv.product_id = p.id AND pv.is_active
      AND (${min}::bigint IS NULL OR pv.price_rwf >= ${min}::bigint)
      AND (${max}::bigint IS NULL OR pv.price_rwf <= ${max}::bigint)
      ${query.availableOnly ? Prisma.sql`AND EXISTS (SELECT 1 FROM avail pa WHERE pa.variant_id = pv.id AND pa.available > 0)` : Prisma.empty})`);
  }

  const relevance = q
    ? Prisma.sql`CASE WHEN lower(p.title) = ${q} THEN 0 WHEN lower(p.title) LIKE ${`${escapeLike(q)}%`} THEN 1
        WHEN lower(p.brand) LIKE ${like} THEN 2 ELSE 3 END`
    : Prisma.sql`0`;
  const order = {
    RELEVANCE: Prisma.sql`relevance ASC, lower(title) ASC, id ASC`,
    PRICE_ASC: Prisma.sql`min_price ASC, lower(title) ASC, id ASC`,
    PRICE_DESC: Prisma.sql`min_price DESC, lower(title) ASC, id ASC`,
    NEWEST: Prisma.sql`published_at DESC NULLS LAST, id ASC`,
  }[query.sort ?? (q ? "RELEVANCE" : "RELEVANCE")];

  const rows = await db().$queryRaw<{ id: string; total: bigint }[]>`
    WITH avail AS (
      SELECT l.variant_id, SUM(l.quantity_on_hand - l.reserved_qty - l.committed_qty) AS available
        FROM commerce.inventory_lots l
       WHERE ${sellableLotCondition("l", scope)}
       GROUP BY l.variant_id
    ), candidates AS (
      SELECT p.id, p.title, p.published_at, ${relevance} AS relevance,
             (SELECT MIN(v.price_rwf) FROM commerce.variants v WHERE v.product_id = p.id AND v.is_active) AS min_price,
             COALESCE((SELECT SUM(GREATEST(a.available, 0)) FROM commerce.variants v
                         JOIN avail a ON a.variant_id = v.id
                        WHERE v.product_id = p.id AND v.is_active), 0) AS available
        FROM commerce.products p
        JOIN commerce.categories c ON c.id = p.category_id
        LEFT JOIN commerce.categories pc ON pc.id = c.parent_id
       WHERE ${Prisma.join(where, " AND ")}
    )
    SELECT id, COUNT(*) OVER () AS total
      FROM candidates
     WHERE min_price IS NOT NULL ${query.availableOnly ? Prisma.sql`AND available > 0` : Prisma.empty}
     ORDER BY ${order}
     LIMIT ${limit + 1} OFFSET ${offset}`;

  const pageIds = rows.slice(0, limit).map((r) => r.id);
  const total = rows.length > 0 ? Number(rows[0]!.total) : 0;
  const items = await loadProducts(pageIds, scope);
  return {
    items,
    nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
    total,
  };
}

export async function getProductBySlug(
  slug: string,
): Promise<PublicProduct | null> {
  const scope = await stockScope();
  const found = await db().$queryRaw<{ id: string }[]>`
    SELECT p.id FROM commerce.products p WHERE p.slug = ${slug} AND ${visibleProductCondition("p")}`;
  if (found.length === 0) return null; // drafts/archived are not reachable by direct URL (CAT-01)
  const [product] = await loadProducts([found[0]!.id], scope);
  return product ?? null;
}

async function availabilityByVariant(
  variantIds: string[],
  scope: StockScope,
): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const rows = await db().$queryRaw<
    { variant_id: string; available: bigint }[]
  >`
    SELECT l.variant_id, SUM(l.quantity_on_hand - l.reserved_qty - l.committed_qty) AS available
      FROM commerce.inventory_lots l
     WHERE l.variant_id IN (${Prisma.join(variantIds.map((id) => Prisma.sql`${id}::uuid`))})
       AND ${sellableLotCondition("l", scope)}
     GROUP BY l.variant_id`;
  return new Map(
    rows.map((r) => [r.variant_id, Math.max(0, Number(r.available))]),
  );
}

export async function availableQuantities(
  variantIds: string[],
): Promise<Map<string, number>> {
  return availabilityByVariant(variantIds, await stockScope());
}

async function loadProducts(
  ids: string[],
  scope: StockScope,
): Promise<PublicProduct[]> {
  if (ids.length === 0) return [];
  const products = await db().product.findMany({
    where: { id: { in: ids } },
    include: {
      category: true,
      variants: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { sku: "asc" }],
      },
      media: {
        where: { reviewState: "APPROVED" },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  const available = await availabilityByVariant(
    products.flatMap((p) => p.variants.map((v) => v.id)),
    scope,
  );
  const byId = new Map(products.map((p) => [p.id, p]));
  return ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
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
      images: p.media
        .filter((m) => !m.variantId)
        .map((m) => ({ url: mediaUrl(m.storageKey), alt: m.alt })),
      variants: p.variants.map((v) => {
        const media = p.media.find((m) => m.variantId === v.id);
        return {
          id: v.id,
          sku: v.sku,
          attributes: v.attributes as Record<string, string>,
          priceRwf: toRwf(v.priceRwf),
          isAvailable: (available.get(v.id) ?? 0) > 0,
          imageUrl: media ? mediaUrl(media.storageKey) : null,
        };
      }),
    }));
}

export async function listCategories(): Promise<PublicCategory[]> {
  // Published, non-empty categories only: no empty departments in navigation.
  const rows = await db().$queryRaw<
    { id: string; slug: string; title: string; parent_id: string | null }[]
  >`
    SELECT c.id, c.slug, c.title, c.parent_id
      FROM commerce.categories c
     WHERE c.is_published
       AND EXISTS (
         SELECT 1 FROM commerce.products p
          JOIN commerce.categories pc ON pc.id = p.category_id
         WHERE (pc.id = c.id OR pc.parent_id = c.id) AND ${visibleProductCondition("p")})
     ORDER BY c.sort_order, c.title`;
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    parentId: r.parent_id,
  }));
}
