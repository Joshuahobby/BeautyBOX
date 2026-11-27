import { z } from "@/lib/validation";

// Strict runtime schemas for staff requests (docs/api: ProductDraftInput, inventory and
// membership commands). Domain rules (unique SKU, stock bounds) are enforced again in modules.

const safeInt = (min: number) =>
  z.number().int().min(min).max(Number.MAX_SAFE_INTEGER);

export const productDraftInput = z.strictObject({
  title: z.string().min(1).max(180),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(120),
  brand: z.string().min(1).max(120),
  categoryId: z.uuid(),
  description: z.string().max(12000),
  variants: z
    .array(
      z.strictObject({
        id: z.uuid().nullable(),
        sku: z.string().min(2).max(64),
        attributes: z.record(z.string(), z.string().max(80)),
        priceRwf: safeInt(1),
        isActive: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
  media: z
    .array(
      z.strictObject({
        storageKey: z.string().min(3).max(200),
        alt: z.string().max(240),
        variantId: z.uuid().nullable(),
        sortOrder: safeInt(0),
      }),
    )
    .max(20),
  contentReviewed: z.boolean(),
  imageRightsConfirmed: z.boolean(),
  isSynthetic: z.boolean(),
});

export const replaceDraftInput = z.strictObject({
  expectedVersion: safeInt(1),
  draft: productDraftInput,
});

export const publicationInput = z.strictObject({
  expectedVersion: safeInt(1),
  state: z.enum(["PUBLISHED", "ARCHIVED"]),
  reason: z.string().min(1).max(500),
});

export const bulkActionInput = z.strictObject({
  productIds: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(["PUBLISH", "ARCHIVE"]),
  reason: z.string().min(1).max(500),
});

export const stockAdjustmentInput = z.strictObject({
  lotId: z.uuid(),
  expectedVersion: safeInt(1),
  quantityDelta: z.number().int().min(-1_000_000).max(1_000_000),
  reason: z.string().min(1).max(500),
  reference: z.string().min(1).max(120),
});

export const importRow = z.strictObject({
  sku: z.string().min(1).max(64),
  quantityOnHand: safeInt(0),
  ownership: z.enum(["OWNED", "CONSIGNED"]),
  supplierId: z.uuid().nullable(),
  agreementReference: z.string().max(120).nullable(),
  batchReference: z.string().min(1).max(80),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  unitCostRwf: safeInt(0).nullable(),
});

export const importPreviewInput = z.strictObject({
  rows: z.array(importRow).min(1).max(1000),
});

export const importApplyInput = z.strictObject({
  sourceHash: z.string().min(16).max(128),
  reason: z.string().min(1).max(500),
});

export const setStaffRoleInput = z.strictObject({
  expectedVersion: safeInt(1),
  role: z.enum(["ADMIN", "OPERATIONS", "FINANCE", "SUPPORT"]),
  isActive: z.boolean(),
  reason: z.string().min(1).max(500),
});

export const pageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

// ---------------------------------------------------------------- orders, refunds, access (I09-I11)

const version = safeInt(1);
const reason = z.string().trim().min(1).max(500);
const isoTime = z.iso.datetime({ offset: true });

export const orderCommandInput = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("START_PREPARATION"),
    expectedVersion: version,
    reason,
  }),
  z.strictObject({
    action: z.literal("ASSIGN_RIDER"),
    expectedVersion: version,
    reason,
    riderReference: z.string().trim().min(1).max(120),
  }),
  z.strictObject({
    action: z.literal("HAND_OVER"),
    expectedVersion: version,
    reason,
    riderReference: z.string().trim().min(1).max(120),
    occurredAt: isoTime,
  }),
  z.strictObject({
    action: z.literal("CONFIRM_DELIVERY"),
    expectedVersion: version,
    reason,
    occurredAt: isoTime,
    confirmationReference: z.string().max(200),
  }),
  z.strictObject({
    action: z.literal("RECORD_FAILED_ATTEMPT"),
    expectedVersion: version,
    reason,
    occurredAt: isoTime,
    custody: z.enum(["RIDER", "BEAUTYBOX", "RECIPIENT"]),
  }),
  z.strictObject({
    action: z.literal("CANCEL"),
    expectedVersion: version,
    reason,
  }),
  z.strictObject({
    action: z.literal("HOLD"),
    expectedVersion: version,
    reason,
  }),
]);

export const staffOrderQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  state: z
    .enum([
      "AWAITING_PAYMENT",
      "PAID",
      "PREPARING",
      "ON_HOLD",
      "DISPATCHED",
      "DELIVERED",
      "CANCELLED",
    ])
    .optional(),
  reference: z.string().trim().max(20).optional(),
  from: isoTime.optional(),
  to: isoTime.optional(),
});

export const refundRequestInput = z.strictObject({
  orderId: z.uuid(),
  receiptId: z.uuid(),
  amountRwf: safeInt(1),
  reason,
});

export const refundDecisionInput = z.strictObject({
  expectedVersion: version,
  decision: z.enum(["APPROVE", "REJECT"]),
  reason,
});

/** CC-18: finance resolves a refund flagged NEEDS_REVIEW. */
export const refundReviewInput = z.strictObject({
  expectedVersion: version,
  outcome: z.enum(["AS_RECORDED", "PAID_BY_PROVIDER"]),
  providerReference: z.string().trim().max(200).nullable().optional(),
  paidAmountRwf: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .optional(),
  reason,
});

export const reasonInput = z.strictObject({ reason });

export const accessReissueInput = z.strictObject({
  expectedVersion: version,
  verificationCaseReference: z.string().trim().min(1).max(120),
  reason,
});

export const uuidPageQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

// ---------------------------------------------------------------- media (contract createMediaUploadIntent / finalizeMedia)

export const mediaIntentInput = z.strictObject({
  purpose: z.enum(["PRODUCT_PHOTO", "PRIVATE_EVIDENCE"]),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().min(1).max(10_000_000),
});

export const mediaFinalizeInput = z.strictObject({ alt: z.string().max(240) });

// ---------------------------------------------------------------- suppliers and settings (contract supplier/settings operations)

export const supplierCreateInput = z.strictObject({
  name: z.string().max(160),
  agreementReference: z.string().max(120),
});

export const supplierEditInput = z.strictObject({
  expectedVersion: safeInt(1),
  name: z.string().max(160),
  agreementReference: z.string().max(120),
  isActive: z.boolean(),
  reason: z.string().max(500),
});

export const settlementInput = z.strictObject({
  expectedVersion: safeInt(1),
  manualReference: z.string().min(1).max(120),
  reason: z.string().max(500),
});

export const obligationQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  supplierId: z.uuid().optional(),
  state: z.enum(["OPEN", "SETTLED"]).optional(),
});

const nonNegative = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const settingsInput = z.strictObject({
  version: safeInt(1).optional(),
  origin: z
    .strictObject({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .nullable(),
  originLabel: z.string().max(120).nullable(),
  supportPhone: z
    .string()
    .regex(/^\+2507[0-9]{8}$/, "Use +2507XXXXXXXX")
    .nullable(),
  supportEmail: z.email().max(200).nullable(),
  dispatchHours: z.string().max(200).nullable(),
  deliveryPromise: z.string().max(300).nullable(),
  coverageGeoJson: z.record(z.string(), z.unknown()).nullable(),
  tariff: z
    .strictObject({
      baseRwf: nonNegative,
      includedMetres: nonNegative.max(100_000),
      extraRwfPerKm: nonNegative,
      roundingRwf: z.number().int().min(1).max(100_000),
      version: safeInt(1).optional(),
      approved: z.boolean(),
    })
    .nullable(),
  checkoutEnabled: z.boolean(),
  livePaymentsEnabled: z.boolean(),
  // CC-24: customer order messages (e-mail, or SMS when e-mail is off). Optional on input;
  // when left out, the current value is kept.
  notificationsEnabled: z.boolean().optional(),
  publicationBlocks: z.array(z.string().max(60)).max(50).optional(),
  parcelLimits: z
    .strictObject({
      maxWeightGrams: z.number().int().min(1).max(100_000).nullable(),
      maxItems: z.number().int().min(1).max(500),
      allowedClasses: z.array(z.string().max(30)).min(1).max(5),
    })
    .nullable(),
  quoteTtlSeconds: z.number().int().min(60).max(3600),
  originApproved: z.boolean(),
  policiesApproved: z.boolean(),
});

export const settingsUpdateInput = z.strictObject({
  expectedVersion: safeInt(1),
  settings: settingsInput,
  reason: z.string().max(500),
});
