import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/server/db";
import { sha256Hex } from "@/server/crypto";
import { toRwf, multiplyRwf, sumRwf } from "@/modules/shared/money";
import { sellableLotCondition, type StockScope } from "@/modules/inventory/eligibility";
import { serverEnv } from "@/server/env";
import { DomainError } from "@/modules/shared/errors";

// Authoritative evaluation of a cart against current catalog state (FSD CHK-02,
// CHK-04). The browser never supplies prices or availability.

export type LineIssue = "UNAVAILABLE" | "INSUFFICIENT_STOCK" | "PRICE_CHANGED" | "SPECIAL_PARCEL";

export type EvaluatedLine = {
  variantId: string;
  productId: string;
  productSlug: string;
  sku: string;
  title: string;
  attributes: Record<string, string>;
  quantity: number;
  unitPriceRwf: number;
  priceVersion: number;
  seenPriceRwf: number;
  lineTotalRwf: number;
  availableQuantity: number;
  parcelClass: "STANDARD" | "BULKY" | "SPECIAL_HANDLING";
  purchasable: boolean; // published, active and visible
  issues: LineIssue[];
};

export type EvaluatedBasket = {
  lines: EvaluatedLine[];
  subtotalRwf: number;
  canCheckout: boolean;
  fingerprint: string;
};

export async function evaluateBasket(client: Db | Tx, cartId: string, scope: StockScope): Promise<EvaluatedBasket> {
  const demoVisible = serverEnv().DEMO_CATALOG_VISIBLE;
  const lines = await client.cartLine.findMany({
    where: { cartId },
    include: { variant: { include: { product: true } } },
    orderBy: { addedAt: "asc" },
  });
  const variantIds = lines.map((l) => l.variantId);
  const availability = new Map<string, number>();
  if (variantIds.length > 0) {
    const rows = await client.$queryRaw<{ variant_id: string; available: bigint }[]>`
      SELECT l.variant_id, SUM(l.quantity_on_hand - l.reserved_qty - l.committed_qty) AS available
        FROM commerce.inventory_lots l
       WHERE l.variant_id IN (${Prisma.join(variantIds.map((id) => Prisma.sql`${id}::uuid`))})
         AND ${sellableLotCondition("l", scope)}
       GROUP BY l.variant_id`;
    for (const r of rows) availability.set(r.variant_id, Math.max(0, Number(r.available)));
  }

  const evaluated: EvaluatedLine[] = lines.map((line) => {
    const { variant } = line;
    const { product } = variant;
    const visible =
      product.publishState === "PUBLISHED" && variant.isActive && (demoVisible || product.dataOrigin === "VERIFIED");
    const unitPriceRwf = toRwf(variant.priceRwf);
    const available = visible ? (availability.get(variant.id) ?? 0) : 0;
    const issues: LineIssue[] = [];
    if (!visible || available === 0) issues.push("UNAVAILABLE");
    else if (available < line.quantity) issues.push("INSUFFICIENT_STOCK");
    if (toRwf(line.seenPriceRwf) !== unitPriceRwf) issues.push("PRICE_CHANGED");
    if (variant.parcelClass !== "STANDARD") issues.push("SPECIAL_PARCEL");
    return {
      variantId: variant.id,
      productId: product.id,
      productSlug: product.slug,
      sku: variant.sku,
      title: product.title,
      attributes: variant.attributes as Record<string, string>,
      quantity: line.quantity,
      unitPriceRwf,
      priceVersion: variant.priceVersion,
      seenPriceRwf: toRwf(line.seenPriceRwf),
      lineTotalRwf: multiplyRwf(unitPriceRwf, line.quantity),
      availableQuantity: available,
      parcelClass: variant.parcelClass,
      purchasable: visible,
      issues,
    };
  });

  const blocking = evaluated.some((l) => l.issues.some((i) => i !== "PRICE_CHANGED"));
  return {
    lines: evaluated,
    subtotalRwf: sumRwf(evaluated.map((l) => l.lineTotalRwf)),
    canCheckout: evaluated.length > 0 && !blocking,
    fingerprint: basketFingerprint(evaluated),
  };
}

/** Binds a quote to the exact priced basket: variant, quantity, price version, parcel class. */
export function basketFingerprint(
  lines: Pick<EvaluatedLine, "variantId" | "quantity" | "unitPriceRwf" | "priceVersion" | "parcelClass">[],
): string {
  const canonical = [...lines]
    .sort((a, b) => (a.variantId < b.variantId ? -1 : 1))
    .map((l) => `${l.variantId}:${l.quantity}:${l.unitPriceRwf}:${l.priceVersion}:${l.parcelClass}`)
    .join("|");
  return sha256Hex(canonical);
}

/** Shared guard so cart, checkout, quote and payment report the same, specific reason. */
export function assertBasketPurchasable(basket: EvaluatedBasket): void {
  if (basket.canCheckout) return;
  if (basket.lines.length === 0) {
    throw new DomainError("VALIDATION_ERROR", "Your cart is empty.", { fieldErrors: [{ field: "cart", message: "Your cart is empty." }] });
  }
  const stockIssue = basket.lines.some((l) => l.issues.includes("UNAVAILABLE") || l.issues.includes("INSUFFICIENT_STOCK"));
  if (!stockIssue && basket.lines.some((l) => l.issues.includes("SPECIAL_PARCEL"))) {
    throw new DomainError("VALIDATION_ERROR", "Some items in your cart need special delivery that isn't available yet.", {
      fieldErrors: [{ field: "parcel", message: "Remove items that need special delivery to continue." }],
    });
  }
  throw new DomainError("STOCK_CHANGED", "The available quantity changed. Review your basket to continue.");
}
