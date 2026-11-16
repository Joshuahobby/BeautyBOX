import "server-only";
import {
  SILVERBACK_MALL,
  KIGALI_COVERAGE,
  KIGALI_TARIFF,
} from "@/config/delivery/kigali";
import type {
  DataOrigin,
  LotOwnership,
  ParcelClass,
} from "@/generated/prisma/client";
import { db, transaction } from "@/server/db";
import { serverEnv } from "@/server/env";
import { applyLotDelta } from "@/modules/inventory/stock";

// Fixture builders for LOCAL demo data and TEST scenarios. They refuse to run when the
// application or the database says production, so synthetic content can never be
// written where real customers shop.

/**
 * Local and test only, unless `staging` is passed: then a staging deployment whose database
 * profile is STAGING with demo data allowed may receive synthetic data too (scripts/seed-staging.ts).
 * Production is always refused.
 */
export async function assertFixturesAllowed(opts: { staging?: boolean } = {}) {
  const appEnv = serverEnv().APP_ENV;
  const stagingAllowed = opts.staging === true && appEnv === "staging";
  if (appEnv === "production" || (appEnv === "staging" && !stagingAllowed)) {
    throw new Error("Fixtures are forbidden outside local/test environments");
  }
  const profile = await db().deploymentProfile.findUnique({ where: { id: 1 } });
  const expected = stagingAllowed ? "STAGING" : null;
  if (
    !profile ||
    !profile.demoDataAllowed ||
    profile.environment === "PRODUCTION" ||
    (expected
      ? profile.environment !== expected
      : profile.environment === "STAGING")
  ) {
    throw new Error("Database deployment profile does not allow demo fixtures");
  }
}

/** Synthetic coverage around central Kigali for the demo tariff (not an approved service area). */
export const DEMO_COVERAGE = {
  type: "polygon" as const,
  label: "Demo coverage (synthetic, central Kigali)",
  polygon: [
    [-1.86, 29.98],
    [-1.86, 30.2],
    [-2.06, 30.2],
    [-2.06, 29.98],
  ] as [number, number][],
};

/** Synthetic dispatch pin (central Kigali). Real origin is founder input B03. */
export const DEMO_ORIGIN = { lat: -1.944, lng: 30.0619 };

export async function seedBaseConfiguration(
  opts: {
    checkoutEnabled?: boolean;
    reservationTtlSeconds?: number;
    quoteTtlSeconds?: number;
    notificationsEnabled?: boolean;
    staging?: boolean;
    kigaliDelivery?: boolean;
  } = {},
) {
  await assertFixturesAllowed({ staging: opts.staging });
  return transaction(async (tx) => {
    const seller = await tx.seller.create({
      data: { name: "BeautyBOX (demo seller record)", isActive: true },
    });
    const location = await tx.dispatchLocation.create({
      data: {
        sellerId: seller.id,
        label: opts.kigaliDelivery
          ? SILVERBACK_MALL.label
          : "Demo dispatch point (synthetic pin)",
        addressText: opts.kigaliDelivery
          ? SILVERBACK_MALL.addressText
          : opts.staging
            ? "Synthetic location for the staging site only"
            : "Synthetic location for local development only",
        lat: opts.kigaliDelivery ? SILVERBACK_MALL.lat : DEMO_ORIGIN.lat,
        lng: opts.kigaliDelivery ? SILVERBACK_MALL.lng : DEMO_ORIGIN.lng,
        parcelRules: { maxTotalUnits: 20 },
        isActive: true,
        approvalState: opts.kigaliDelivery ? "PROPOSED" : "DEMO",
        dataOrigin: "SYNTHETIC_DEMO",
      },
    });
    const tariff = await tx.tariff.create({
      data: {
        version: 1,
        baseRwf: 1500n,
        includedMetres: 3000,
        extraRwfPerKm: opts.kigaliDelivery
          ? BigInt(KIGALI_TARIFF.extraRwfPerKm)
          : 300n,
        roundingRwf: 100n,
        maxDistanceMetres: opts.kigaliDelivery
          ? KIGALI_TARIFF.maxDistanceMetres
          : 25_000,
        coverageRules: opts.kigaliDelivery ? KIGALI_COVERAGE : DEMO_COVERAGE,
        approvalState: opts.kigaliDelivery ? "PROPOSED" : "DEMO",
        dataOrigin: "SYNTHETIC_DEMO",
        reason: opts.kigaliDelivery
          ? "Owner-selected Kigali starting tariff; local rehearsal, live routing pending"
          : "Proposed FSD DEL-03 test tariff; not an approved courier rate",
      },
    });
    const settings = await tx.settingsVersion.create({
      data: {
        version: 1,
        checkoutEnabled: opts.checkoutEnabled ?? true,
        livePaymentsEnabled: false,
        // Local/test: the fake SMS adapter only writes to the simulated inbox.
        notificationsEnabled: opts.notificationsEnabled ?? true,
        quoteTtlSeconds: opts.quoteTtlSeconds ?? 900,
        reservationTtlSeconds: opts.reservationTtlSeconds ?? 900,
        paymentMethodAllowlist: ["MTN_MOMO_RWA", "AIRTEL_RWA"],
        activeTariffId: tariff.id,
        activeLocationId: location.id,
        supportContact: undefined,
        deliveryPromise: null,
        policiesApproved: false,
        dataOrigin: "SYNTHETIC_DEMO",
        reason: opts.staging
          ? "Staging demo configuration (synthetic)"
          : "Local demo configuration",
      },
    });
    return { seller, location, tariff, settings };
  });
}

export async function createCategory(input: {
  slug: string;
  title: string;
  parentSlug?: string;
  sortOrder?: number;
}) {
  const parent = input.parentSlug
    ? await db().category.findUniqueOrThrow({
        where: { slug: input.parentSlug },
      })
    : null;
  return db().category.create({
    data: {
      slug: input.slug,
      title: input.title,
      parentId: parent?.id ?? null,
      sortOrder: input.sortOrder ?? 0,
      isPublished: true,
    },
  });
}

export type FixtureVariant = {
  sku: string;
  attributes?: Record<string, string>;
  priceRwf: number;
  parcelClass?: ParcelClass;
  lots?: {
    quantity: number;
    supplierSku?: string;
    ownership?: LotOwnership;
    supplierId?: string;
    costBasisRwf?: number;
    expiryDate?: string;
    batch?: string;
  }[];
};

export async function createProduct(input: {
  sellerId: string;
  locationId: string;
  categorySlug: string;
  slug: string;
  title: string;
  brand: string;
  description: string;
  packSize?: string | null;
  optionLabel?: string | null;
  dataOrigin: DataOrigin;
  publish?: boolean;
  variants: FixtureVariant[];
}) {
  const category = await db().category.findUniqueOrThrow({
    where: { slug: input.categorySlug },
  });
  const product = await db().product.create({
    data: {
      sellerId: input.sellerId,
      categoryId: category.id,
      slug: input.slug,
      title: input.title,
      brand: input.brand,
      description: input.description,
      packSize: input.packSize ?? null,
      optionLabel: input.optionLabel ?? null,
      dataOrigin: input.dataOrigin,
      publishState: input.publish === false ? "DRAFT" : "PUBLISHED",
      publishedAt: input.publish === false ? null : new Date(),
      contentReviewedAt: new Date(),
    },
  });
  const variants = [];
  for (const [i, v] of input.variants.entries()) {
    const variant = await db().variant.create({
      data: {
        productId: product.id,
        sku: v.sku,
        attributes: v.attributes ?? {},
        priceRwf: BigInt(v.priceRwf),
        parcelClass: v.parcelClass ?? "STANDARD",
        sortOrder: i,
      },
    });
    for (const [j, lot] of (v.lots ?? []).entries()) {
      await receiveStock({
        variantId: variant.id,
        locationId: input.locationId,
        quantity: lot.quantity,
        ownership: lot.ownership ?? (lot.supplierId ? "CONSIGNED" : "OWNED"),
        supplierId: lot.supplierId ?? null,
        costBasisRwf: lot.costBasisRwf ?? null,
        expiryDate: lot.expiryDate ?? null,
        batchReference: lot.batch ?? `${v.sku}-LOT-${j + 1}`,
        dataOrigin: input.dataOrigin,
      });
    }
    variants.push(variant);
  }
  return { product, variants };
}

/** Opening stock goes through the same ledger as every other movement. */
export async function receiveStock(input: {
  variantId: string;
  locationId: string;
  quantity: number;
  ownership: LotOwnership;
  supplierId: string | null;
  costBasisRwf: number | null;
  expiryDate: string | null;
  batchReference: string;
  dataOrigin: DataOrigin;
}) {
  return transaction(async (tx) => {
    const lot = await tx.inventoryLot.create({
      data: {
        variantId: input.variantId,
        locationId: input.locationId,
        supplierId: input.supplierId,
        ownership: input.ownership,
        agreementReference: input.supplierId ? "DEMO-AGREEMENT" : null,
        batchReference: input.batchReference,
        quantityOnHand: 0,
        costBasisRwf:
          input.costBasisRwf === null ? null : BigInt(input.costBasisRwf),
        expiryDate: input.expiryDate
          ? new Date(`${input.expiryDate}T00:00:00Z`)
          : null,
        reviewState: "VERIFIED",
        dataOrigin: input.dataOrigin,
      },
    });
    if (input.quantity > 0) {
      await applyLotDelta(
        tx,
        lot.id,
        { onHand: input.quantity, reserved: 0, committed: 0 },
        {
          type: "RECEIPT",
          reason: "Opening fixture stock (synthetic)",
          actor: { type: "SYSTEM", id: null },
        },
      );
    }
    return lot;
  });
}
