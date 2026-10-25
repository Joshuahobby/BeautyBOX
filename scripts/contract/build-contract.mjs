#!/usr/bin/env node
// Builds docs/api/API-Contract-v1.1.openapi.json: the handoff baseline contract (read-only,
// v1.0.0) plus every documented additive change CC-01..CC-20 (docs/CONTRACT-CHANGES.md).
// The integration test tests/integration/contract.test.ts validates real responses
// against this file, so an undocumented response change fails the build.
//
//   node scripts/contract/build-contract.mjs          (write)
//   node scripts/contract/build-contract.mjs --check  (fail if the file is stale)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const baselinePath = path.resolve(root, "..", "BeautyBOX-Handoff-v1.0", "technical", "API-Contract.openapi.json");
const outPath = path.join(root, "docs", "api", "API-Contract-v1.1.openapi.json");
const c = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const S = c.components.schemas;

const MAX = 9007199254740991;
const uuid = { type: "string", format: "uuid" };
const dt = { type: "string", format: "date-time" };
const int0 = { type: "integer", minimum: 0, maximum: MAX };
const int1 = { type: "integer", minimum: 1, maximum: MAX };
const str = { type: "string" };
const bool = { type: "boolean" };
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const obj = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const ORDER_STATES = ["AWAITING_PAYMENT", "PAID", "PREPARING", "ON_HOLD", "DISPATCHED", "DELIVERED", "CANCELLED"];
const ATTEMPT_STATES = ["CREATED", "PENDING", "SUCCEEDED", "FAILED"];
const HOLD = nullable({ type: "string", enum: ["STOCK_UNAVAILABLE", "PAYMENT_REVIEW", "MANUAL"] });
const errorResponse = { description: "Structured failure", content: { "application/json": { schema: ref("Error") } } };
const json = (schema, description = "Success") => ({ description, content: { "application/json": { schema } } });

function extend(name, cc, properties, { required = Object.keys(properties) } = {}) {
  const schema = S[name];
  if (!schema?.properties) throw new Error(`no schema ${name}`);
  for (const [k, v] of Object.entries(properties)) {
    if (schema.properties[k]) throw new Error(`${name}.${k} already exists`);
    schema.properties[k] = { ...v, description: `${cc} addition` };
  }
  schema.required = [...new Set([...(schema.required ?? []), ...required])];
}

// CC-01 Checkout recovery
extend("Checkout", "CC-01", {
  quote: nullable(obj({ id: uuid, amountRwf: int0, validUntil: dt, tariffVersion: int1, serviceDescription: str })),
  orderId: nullable(uuid),
  orderReference: nullable(str),
  activeAttemptId: nullable(uuid),
  lastAttempt: nullable(obj({ id: uuid, state: { type: "string", enum: ATTEMPT_STATES } })),
});
// CC-02 Cart issues
extend("Cart", "CC-02", { canCheckout: bool, paymentPending: bool, checkoutId: nullable(uuid) });
extend("CartLine", "CC-02", {
  productSlug: str,
  sku: str,
  previousUnitPriceRwf: nullable(int0),
  issues: { type: "array", items: { type: "string", enum: ["UNAVAILABLE", "INSUFFICIENT_STOCK", "PRICE_CHANGED", "SPECIAL_PARCEL"] } },
});
// CC-03 PaymentAttempt
extend("PaymentAttempt", "CC-03", { orderReference: str, orderState: { type: "string", enum: ORDER_STATES }, createdAt: dt });
// CC-04 customer Order
extend("Order", "CC-04", {
  isDemo: bool,
  holdReason: HOLD,
  paidAt: nullable(dt),
  latestAttempt: nullable(obj({ id: uuid, state: { type: "string", enum: ATTEMPT_STATES } })),
  fulfillment: nullable(obj({ state: str, deliveredAt: nullable(dt), promisedWindowStart: nullable(dt), promisedWindowEnd: nullable(dt) })),
  cancellationRequest: nullable(obj({ operationId: uuid, state: { type: "string", enum: ["PENDING", "SUCCEEDED", "FAILED"] }, outcome: nullable(str) })),
  canRequestCancellation: bool,
  canCreatePrivateLink: bool,
});
// CC-06 Product
extend("Product", "CC-06", { categoryTitle: str, packSize: nullable(str), optionLabel: nullable(str), isDemo: bool });
// CC-07 ProductPage total
extend("ProductPage", "CC-07", { total: int0 });
// CC-09 StockLot
extend("StockLot", "CC-09", { sku: str, productTitle: str, batchReference: str, isSynthetic: bool });
// CC-10 /staff/me
S.StaffMe = { ...structuredClone(S.StaffMember), description: "CC-10: StaffMember plus server-derived capabilities" };
S.StaffMe.properties.capabilities = { type: "array", items: str };
S.StaffMe.required = [...S.StaffMe.required, "capabilities"];
c.paths["/staff/me"].get.responses["200"] = json(ref("StaffMe"));
// CC-11 StaffOrder (and masked contact for roles without orders.readContact)
S.MaskedRecipient = obj(
  { name: { type: "string", minLength: 1, maxLength: 120 }, phone: { type: "string", pattern: "^\\+2507\\*{6}[0-9]{2}$" } },
  ["name", "phone"],
);
S.MaskedRecipient.description = "CC-11: recipient as shown to roles without contact access (last two digits only)";
S.StaffOrder.properties.recipient = { anyOf: [ref("Recipient"), ref("MaskedRecipient")], description: "CC-11: masked for roles without contact access" };
S.StaffOrder.properties.destination = { anyOf: [ref("Point"), { type: "null" }], description: "CC-11: null for roles without contact access" };
const refundItem = S.StaffOrder.properties.refunds.items;
Object.assign(refundItem.properties, { version: int1, reason: str, receiptId: uuid });
refundItem.required = [...refundItem.required, "version", "reason", "receiptId"];
extend("StaffOrder", "CC-11", {
  isDemo: bool,
  holdReason: HOLD,
  deliveryState: nullable(str),
  contactVisible: bool,
  cancellationRequest: nullable(obj({ operationId: uuid, reason: str, requestedAt: dt })),
  receipts: { type: "array", items: obj({ id: uuid, amountRwf: int0, disposition: str, verifiedAt: dt, remainingRefundableRwf: int0 }) },
  attempts: {
    type: "array",
    items: obj({ id: uuid, state: { type: "string", enum: ATTEMPT_STATES }, verificationFlag: nullable({ type: "string", enum: ["UNKNOWN", "MISMATCH", "NEEDS_REVIEW"] }), method: { type: "string", enum: ["MTN_MOMO_RWA", "AIRTEL_RWA"] }, createdAt: dt }),
  },
  notifications: { type: "array", items: obj({ event: str, state: str, lastErrorCode: nullable(str), createdAt: dt }) },
  deliveryAttempts: { type: "array", items: obj({ outcome: str, occurredAt: dt, custody: nullable(str), reason: nullable(str) }) },
});
S.StaffOrderSummary = obj({
  id: uuid,
  reference: str,
  version: int1,
  state: { type: "string", enum: ORDER_STATES },
  paymentState: S.StaffOrder.properties.paymentState,
  totalRwf: int0,
  itemCount: int0,
  deliveryState: nullable(str),
  holdReason: HOLD,
  createdAt: dt,
  isDemo: bool,
  attentionFlag: nullable(str),
  cancellationRequested: bool,
  smsProblem: bool,
});
S.StaffOrderSummary.description = "CC-11: queue item without contact data";
S.StaffOrderPage.properties.items = { type: "array", items: ref("StaffOrderSummary") };
// CC-12 Operation
extend("Operation", "CC-12", {
  type: { type: "string", enum: ["CANCELLATION_REQUEST", "PAYMENT_RECONCILE", "REFUND_RECONCILE", "ACCESS_REISSUE"] },
  outcome: nullable(str),
});
// CC-13 PaymentException
extend("PaymentException", "CC-13", { orderReference: str, attemptState: { type: "string", enum: ATTEMPT_STATES }, amountRwf: int0 });
// CC-14 media
const finalize = c.paths["/staff/media/{uploadId}/finalize"].post;
const finalizeSchema = finalize.responses["200"].content["application/json"].schema;
Object.assign(finalizeSchema.properties, { url: nullable({ type: "string", format: "uri" }), width: nullable(int1), height: nullable(int1), rejectReason: nullable(str) });
finalizeSchema.required = [...finalizeSchema.required, "url", "width", "height", "rejectReason"];
c.paths["/staff/media/{uploadId}/content"] = {
  put: {
    operationId: "uploadMediaContent",
    summary: "CC-14: upload bytes for an intent (local storage target)",
    description: "Only the staff member who created the intent; Content-Type and size must match the intent. Hosted storage uses a signed URL instead.",
    security: [{ StaffSession: [] }],
    parameters: [{ name: "uploadId", in: "path", required: true, schema: uuid }],
    requestBody: { required: true, content: { "image/jpeg": { schema: { type: "string", format: "binary" } }, "image/png": { schema: { type: "string", format: "binary" } }, "image/webp": { schema: { type: "string", format: "binary" } } } },
    responses: { 200: json(obj({ uploadId: uuid, received: bool })), default: errorResponse },
  },
};
// CC-15 StaffProduct editing context
extend("StaffProduct", "CC-15", {
  categoryId: uuid,
  isSynthetic: bool,
  contentReviewed: bool,
  imageRightsConfirmed: bool,
  variants: { type: "array", items: obj({ id: uuid, sku: str, attributes: { type: "object", additionalProperties: str }, priceRwf: int0, isActive: bool, available: int0 }) },
  media: {
    type: "array",
    items: obj({ storageKey: str, alt: str, variantId: nullable(uuid), sortOrder: int0, reviewState: { type: "string", enum: ["PENDING", "APPROVED", "REJECTED"] }, url: { type: "string", format: "uri" } }),
  },
});
// CC-16 suppliers, obligations and settings
extend("Supplier", "CC-16", { isDemo: bool });
extend("SupplierObligation", "CC-16", {
  supplierName: str,
  orderReference: str,
  quantity: int1,
  sku: str,
  allocationState: { type: "string", enum: ["COMMITTED", "SHIPPED", "RELEASED"] },
  settleable: bool,
  blockedReason: nullable(str),
  settledAt: nullable(dt),
  createdAt: dt,
});
extend("Settings", "CC-16", { originApproved: bool, policiesApproved: bool });
{
  const parcel = S.Settings.properties.parcelLimits.anyOf[0];
  parcel.properties.maxWeightGrams = { ...nullable(parcel.properties.maxWeightGrams), description: "CC-16: null until set; recorded, not enforced until products carry weights" };
}
// CC-17 refund verification evidence (a provider-confirmed amount that differs)
const refundFlag = nullable({ type: "string", enum: ["UNKNOWN", "MISMATCH", "NEEDS_REVIEW"] });
extend("Refund", "CC-17", { verificationFlag: refundFlag, providerAmountRwf: nullable(int0) });
Object.assign(refundItem.properties, { verificationFlag: refundFlag, providerAmountRwf: nullable(int0) });
refundItem.required = [...refundItem.required, "verificationFlag", "providerAmountRwf"];
// CC-18 finance resolves a refund the provider's records disagree with (DR-043)
c.paths["/staff/refunds/{refundId}/review-resolution"] = {
  post: {
    operationId: "resolveRefundReview",
    summary: "CC-18: finance resolves a refund flagged NEEDS_REVIEW",
    description:
      "Only for a refund with verificationFlag NEEDS_REVIEW, after checking the payment in the provider's dashboard. AS_RECORDED clears the flag (a failed refund's amount becomes refundable again). PAID_BY_PROVIDER records a refund recorded as failed as paid out, for paidAmountRwf (default and maximum: the refund's amount), with the provider reference finance saw (required). Audited; never moves money.",
    security: [{ StaffSession: [] }],
    "x-required-roles": ["ADMIN", "FINANCE"],
    parameters: [{ name: "refundId", in: "path", required: true, schema: uuid }, { $ref: "#/components/parameters/IdempotencyKey" }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: obj(
            { expectedVersion: int1, outcome: { type: "string", enum: ["AS_RECORDED", "PAID_BY_PROVIDER"] }, providerReference: nullable({ type: "string", maxLength: 200 }), paidAmountRwf: nullable(int1), reason: str },
            ["expectedVersion", "outcome", "reason"],
          ),
        },
      },
    },
    responses: { 200: json(ref("Refund")), default: errorResponse },
  },
};
// CC-19 provider references on the staff order, for finance to look the payment up
Object.assign(refundItem.properties, { providerRefundId: nullable(uuid), failureCode: nullable(str), resolutionReference: nullable(str) });
refundItem.required = [...refundItem.required, "providerRefundId", "failureCode", "resolutionReference"];
{
  const receiptItem = S.StaffOrder.properties.receipts.items;
  receiptItem.properties.providerPaymentId = str;
  receiptItem.required = [...receiptItem.required, "providerPaymentId"];
}
// CC-05 places
S.PlaceSuggestion = obj({ placeId: str, label: str, secondary: nullable(str) });
c.paths["/places"] = {
  get: {
    operationId: "searchPlaces",
    summary: "CC-05: server-side place search (suggestions only)",
    security: [{ GuestSession: [] }],
    parameters: [{ name: "q", in: "query", required: true, schema: { type: "string", maxLength: 80 } }],
    responses: { 200: json(obj({ items: { type: "array", items: ref("PlaceSuggestion") } })), default: errorResponse },
  },
};
c.paths["/places/{placeId}"] = {
  get: {
    operationId: "resolvePlace",
    summary: "CC-05: resolve a suggestion to a pin the customer still confirms",
    security: [{ GuestSession: [] }],
    parameters: [{ name: "placeId", in: "path", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,200}$" } }],
    responses: { 200: json(obj({ label: str, point: ref("Point") })), default: errorResponse },
  },
};
// CC-08 owner private link
c.paths["/orders/{orderId}/access-link"] = {
  post: {
    operationId: "createOwnerOrderLink",
    summary: "CC-08: one-time private link for the guest session that placed a paid order",
    security: [{ GuestSession: [] }],
    parameters: [{ name: "orderId", in: "path", required: true, schema: uuid }],
    responses: { 201: json(obj({ url: { type: "string", format: "uri" }, expiresAt: dt })), default: errorResponse },
  },
};

// CC-20 pre-launch wall and launch list (DR-044, DR-045)
c.components.securitySchemes.SiteAccess = {
  type: "apiKey",
  in: "cookie",
  name: "bb_site_access",
  description:
    "CC-20: set by POST /site-access. While the pre-launch wall is on, every operation except the staff API, provider callbacks, the job runner, /site-access and /launch-list answers 401 UNAUTHORIZED (Error) without this cookie. On a holding host (the main domain before launch) only /launch-list is served. The wall is off once the shop opens.",
};
c.paths["/site-access"] = {
  post: {
    operationId: "enterSiteAccessCode",
    summary: "CC-20: enter the pre-launch access code",
    description:
      "Same-origin only; attempts are rate-limited per address. A right code sets the HttpOnly SiteAccess cookie (30 days) and returns where to go next (a same-site path; anything else becomes /). A wrong code is 401 UNAUTHORIZED with a field error on code. When the wall is off it returns next without setting a cookie.",
    security: [],
    requestBody: {
      required: true,
      content: { "application/json": { schema: obj({ code: { type: "string", minLength: 1, maxLength: 200 }, next: { type: "string", maxLength: 512 } }, ["code"]) } },
    },
    responses: { 200: json(obj({ next: { type: "string", pattern: "^/" } })), default: errorResponse },
  },
};
c.paths["/launch-list"] = {
  post: {
    operationId: "joinLaunchList",
    summary: "CC-20: ask for one message when the shop opens (e-mail and/or Rwanda mobile number)",
    description:
      "Accepted from the shop's origin or a holding host. At least one of email or phone, and consent true. 409 ACTION_NOT_ALLOWED while the list is closed. The answer is the same whether or not the details were already on the list. Details are stored encrypted and used only for the launch message.",
    security: [],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: obj({ email: nullable({ type: "string", maxLength: 320 }), phone: nullable({ type: "string", maxLength: 40 }), consent: bool }, ["consent"]),
        },
      },
    },
    responses: { 202: json(obj({ status: { type: "string", enum: ["RECEIVED"] } }), "Received"), default: errorResponse },
  },
};

c.info.version = "1.1.0";
c.info.description = `${c.info.description}\n\nv1.1.0 (BeautyBOX app): the v1.0.0 handoff contract plus documented additive changes CC-01..CC-20 (docs/CONTRACT-CHANGES.md). No v1.0.0 path, request field or status code was removed.`;

const output = `${JSON.stringify(c, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
  if (current !== output) {
    console.error("[contract] docs/api/API-Contract-v1.1.openapi.json is stale; run node scripts/contract/build-contract.mjs");
    process.exit(1);
  }
  console.log("[contract] up to date");
} else {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);
  console.log(`[contract] wrote ${path.relative(root, outPath)} (${Object.keys(c.paths).length} paths, ${Object.keys(S).length} schemas)`);
}
