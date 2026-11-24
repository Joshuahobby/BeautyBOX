import { z } from "zod";

// Runtime request schemas mirroring docs/api/openapi.json (strict: unknown fields are
// rejected, money and versions are safe integers). Domain rules (phone ranges,
// coverage, stock) are enforced again by the modules.

const safeInt = (min: number) =>
  z.number().int().min(min).max(Number.MAX_SAFE_INTEGER);
const uuid = z.uuid();
const rwPhone = z.string().regex(/^\+2507[0-9]{8}$/, "Use +2507XXXXXXXX");

export const cartLineInput = z.strictObject({
  variantId: uuid,
  quantity: z.number().int().min(1).max(99),
  expectedVersion: safeInt(1),
});

export const replaceCartLineInput = z.strictObject({
  replacementVariantId: uuid,
  expectedVersion: safeInt(1),
});

export const removeCartLineInput = z.strictObject({
  expectedVersion: safeInt(1),
});

export const createCheckoutInput = z.strictObject({
  cartId: uuid,
  expectedCartVersion: safeInt(1),
});

export const pointSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const recipientSchema = z.strictObject({
  name: z.string().min(1).max(120),
  phone: rwPhone,
  // CC-22 (DR-059): required for new checkouts; the domain checks the format.
  email: z.string().max(320),
  landmark: z.string().max(240).optional(),
  instructions: z.string().max(500).optional(),
});

export const checkoutPatchInput = z.strictObject({
  expectedRevision: safeInt(1),
  recipient: recipientSchema,
  destination: pointSchema,
  destinationConfirmed: z.literal("CUSTOMER_CONFIRMED"),
});

export const quoteInput = z.strictObject({ expectedRevision: safeInt(1) });

export const payRequestInput = z.strictObject({
  expectedRevision: safeInt(1),
  quoteId: uuid,
  acceptedTotalRwf: safeInt(0),
  method: z.enum(["MTN_MOMO_RWA", "AIRTEL_RWA"]),
  payerPhone: rwPhone,
});

export const orderTokenExchangeInput = z.strictObject({
  token: z.string().min(40).max(200),
});

export const cancellationRequestInput = z.strictObject({
  expectedVersion: safeInt(1),
  reason: z.string().min(1).max(500),
});

export const runJobsInput = z.strictObject({
  batchSize: z.number().int().min(1).max(50),
  maxRuntimeSeconds: z.number().int().min(1).max(40),
});

export const productListQuery = z.object({
  q: z.string().max(100).optional(),
  category: z.string().max(80).optional(),
  brand: z.string().max(80).optional(),
  minPriceRwf: z.coerce
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  maxPriceRwf: z.coerce
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  availableOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  sort: z.enum(["RELEVANCE", "PRICE_ASC", "PRICE_DESC", "NEWEST"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
