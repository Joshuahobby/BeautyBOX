import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import sharp from "sharp";
import { db } from "@/server/db";
import { GUEST_COOKIE } from "@/modules/session/guest-session";
import { orderCookieName } from "@/modules/orders/access";
import { setAdaptersForTests } from "@/adapters/registry";
import { FakeSmsAdapter } from "@/adapters/sms/fake";
import * as categories from "@/app/api/v1/catalog/categories/route";
import * as products from "@/app/api/v1/catalog/products/route";
import * as productBySlug from "@/app/api/v1/catalog/products/[slug]/route";
import * as sessionRoute from "@/app/api/v1/session/route";
import * as cart from "@/app/api/v1/cart/route";
import * as cartLines from "@/app/api/v1/cart/lines/route";
import * as cartLine from "@/app/api/v1/cart/lines/[variantId]/route";
import * as checkouts from "@/app/api/v1/checkouts/route";
import * as checkout from "@/app/api/v1/checkouts/[checkoutId]/route";
import * as quotes from "@/app/api/v1/checkouts/[checkoutId]/quotes/route";
import * as methods from "@/app/api/v1/payment-methods/route";
import * as payment from "@/app/api/v1/payments/[attemptId]/route";
import * as payments from "@/app/api/v1/checkouts/[checkoutId]/payments/route";
import * as order from "@/app/api/v1/orders/[orderId]/route";
import * as cancellation from "@/app/api/v1/orders/[orderId]/cancellation-requests/route";
import * as ownerLink from "@/app/api/v1/orders/[orderId]/access-link/route";
import * as exchange from "@/app/api/v1/order-access/exchange/route";
import * as guestOperation from "@/app/api/v1/operations/[operationId]/route";
import * as places from "@/app/api/v1/places/route";
import * as place from "@/app/api/v1/places/[placeId]/route";
import * as jobs from "@/app/api/v1/internal/jobs/run/route";
import * as me from "@/app/api/v1/staff/me/route";
import * as staffOrders from "@/app/api/v1/staff/orders/route";
import * as staffOrder from "@/app/api/v1/staff/orders/[orderId]/route";
import * as commands from "@/app/api/v1/staff/orders/[orderId]/commands/route";
import * as accessLinks from "@/app/api/v1/staff/orders/[orderId]/access-links/route";
import * as receipts from "@/app/api/v1/staff/receipts/route";
import * as exceptions from "@/app/api/v1/staff/payment-exceptions/route";
import * as paymentReconcile from "@/app/api/v1/staff/payments/[attemptId]/reconcile/route";
import * as refunds from "@/app/api/v1/staff/refunds/route";
import * as refundDecision from "@/app/api/v1/staff/refunds/[refundId]/decision/route";
import * as refundReconcile from "@/app/api/v1/staff/refunds/[refundId]/reconcile/route";
import * as refundReview from "@/app/api/v1/staff/refunds/[refundId]/review-resolution/route";
import * as staffOperation from "@/app/api/v1/staff/operations/[operationId]/route";
import * as inventory from "@/app/api/v1/staff/inventory/route";
import * as adjustments from "@/app/api/v1/staff/inventory/adjustments/route";
import * as importPreviews from "@/app/api/v1/staff/inventory/import-previews/route";
import * as importApply from "@/app/api/v1/staff/inventory/import-previews/[previewId]/apply/route";
import * as staffProducts from "@/app/api/v1/staff/products/route";
import * as staffProduct from "@/app/api/v1/staff/products/[productId]/route";
import * as publication from "@/app/api/v1/staff/products/[productId]/publication/route";
import * as members from "@/app/api/v1/staff/members/route";
import * as member from "@/app/api/v1/staff/members/[memberId]/route";
import * as mediaIntents from "@/app/api/v1/staff/media/upload-intents/route";
import * as mediaContent from "@/app/api/v1/staff/media/[uploadId]/content/route";
import * as mediaFinalize from "@/app/api/v1/staff/media/[uploadId]/finalize/route";
import * as suppliersRoute from "@/app/api/v1/staff/suppliers/route";
import * as supplierRoute from "@/app/api/v1/staff/suppliers/[supplierId]/route";
import * as obligationsRoute from "@/app/api/v1/staff/supplier-obligations/route";
import * as settlementRoute from "@/app/api/v1/staff/supplier-obligations/[obligationId]/settlement/route";
import * as settingsRoute from "@/app/api/v1/staff/settings/route";
import * as launchListRoute from "@/app/api/v1/launch-list/route";
import * as siteAccessRoute from "@/app/api/v1/site-access/route";
import { resetServerEnvForTests } from "@/server/env";
import { hashAccessCode } from "@/server/site-gate";
import {
  applyOrderCommand,
  type OrderCommand,
} from "@/modules/fulfillment/commands";
import {
  DEST_5KM,
  drainJobs,
  resetDatabase,
  seedShop,
  settleAndDrain,
  type Shop,
} from "./harness";

// Contract conformance (API-Notes "exercise actual requests/responses against the
// contract"): every response below comes from the real route handler against the real
// test database and is validated against docs/api/API-Contract-v1.2.openapi.json
// (the handoff v1.0 contract plus documented additions CC-01..CC-20) — operation, status
// code and body, with additionalProperties enforced. An undocumented field fails here.

type Json = Record<string, unknown>;
type Handler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string | string[]>> },
) => Promise<Response>;

const contract = JSON.parse(
  fs.readFileSync(
    path.resolve(
      process.cwd(),
      "docs",
      "api",
      "API-Contract-v1.2.openapi.json",
    ),
    "utf8",
  ),
) as {
  paths: Record<
    string,
    Record<
      string,
      {
        responses: Record<
          string,
          { content?: Record<string, { schema: object }> }
        >;
      }
    >
  >;
  components: object;
};
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const templates = Object.keys(contract.paths).sort(
  (a, b) => (a.match(/\{/g)?.length ?? 0) - (b.match(/\{/g)?.length ?? 0),
);
const checked = new Set<string>();
let violations: string[] = [];

function operationFor(method: string, pathname: string) {
  const p = pathname.replace(/^\/api\/v1/, "");
  const template = templates.find((t) =>
    new RegExp(`^${t.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(p),
  );
  if (!template) throw new Error(`no contract path for ${p}`);
  const op = contract.paths[template]![method.toLowerCase()];
  if (!op) throw new Error(`contract has no ${method} ${template}`);
  return { template, op };
}

function validate(
  method: string,
  pathname: string,
  status: number,
  body: unknown,
) {
  const { template, op } = operationFor(method, pathname);
  const response =
    op.responses[String(status)] ??
    (status >= 400 ? op.responses.default : undefined);
  checked.add(`${method.toUpperCase()} ${template}`);
  if (!response) {
    violations.push(
      `${method} ${template}: status ${status} is not in the contract (${Object.keys(op.responses).join(", ")})`,
    );
    return;
  }
  const schema = response.content?.["application/json"]?.schema;
  if (!schema) {
    violations.push(`${method} ${template} ${status}: no JSON schema`);
    return;
  }
  const validator = ajv.compile({ ...schema, components: contract.components });
  if (!validator(body)) {
    const detail = (validator.errors ?? []).map((e) => {
      const p = e.params as Record<string, unknown>;
      const extra =
        p.missingProperty ?? p.additionalProperty ?? p.pattern ?? "";
      return `${e.instancePath || "/"} ${e.message}${extra ? ` (${String(extra)})` : ""}`;
    });
    violations.push(
      `${method} ${template} ${status}: ${[...new Set(detail)].slice(0, 12).join("; ")}`,
    );
  }
}

/** Each scenario ends by asserting that no response broke the contract. */
function expectConformance() {
  expect(violations).toEqual([]);
}

const origin = () => process.env.APP_ORIGIN!;
type Opts = {
  status?: number;
  body?: unknown;
  staff?: string;
  cookies?: Record<string, string>;
  params?: Record<string, string | string[]>;
  raw?: Buffer;
  contentType?: string;
  bearer?: string;
};

async function call(
  route: unknown,
  method: string,
  pathWithQuery: string,
  opts: Opts = {},
) {
  const headers: Record<string, string> = { origin: origin() };
  if (opts.staff) headers["x-test-staff"] = opts.staff;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.cookies && Object.keys(opts.cookies).length)
    headers.cookie = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  if (method !== "GET") {
    headers["content-type"] = opts.contentType ?? "application/json";
    headers["idempotency-key"] = `test-${randomUUID()}`;
  }
  const body = opts.raw
    ? new Uint8Array(opts.raw)
    : opts.body === undefined
      ? undefined
      : JSON.stringify(opts.body);
  const handler = route as Handler;
  const res = await handler(
    new NextRequest(`${origin()}/api/v1${pathWithQuery}`, {
      method,
      headers,
      body,
    }),
    { params: Promise.resolve(opts.params ?? {}) },
  );
  const json = (await res.json()) as Json;
  if (opts.status ? res.status !== opts.status : res.status >= 400) {
    violations.push(
      `${method} ${pathWithQuery}: expected ${opts.status ?? "success"}, got ${res.status} ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  validate(
    method,
    new URL(`${origin()}/api/v1${pathWithQuery}`).pathname,
    res.status,
    json,
  );
  return { status: res.status, body: json, res };
}

let shop: Shop;
let sms: FakeSmsAdapter;

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  violations = [];
  await resetDatabase();
  shop = await seedShop();
  sms = new FakeSmsAdapter();
  setAdaptersForTests({ sms });
});

async function staffHeader(
  role: "ADMIN" | "OPERATIONS" | "FINANCE" | "SUPPORT",
) {
  const authUserId = randomUUID();
  await db().staffMember.create({
    data: {
      authUserId,
      email: `${role.toLowerCase()}-${authUserId.slice(0, 6)}@example.test`,
      displayName: `Contract ${role}`,
      role,
    },
  });
  return `${authUserId}:aal2`;
}

/** Customer journey through the HTTP layer up to a verified payment. */
async function purchase() {
  const s = await call(sessionRoute.POST, "POST", "/session");
  const token = (
    s.res as unknown as {
      cookies: { get(n: string): { value: string } | undefined };
    }
  ).cookies.get(GUEST_COOKIE)!.value;
  const cookies = { [GUEST_COOKIE]: token };
  await call(categories.GET, "GET", "/catalog/categories");
  await call(products.GET, "GET", "/catalog/products?limit=5");
  await call(productBySlug.GET, "GET", "/catalog/products/test-lip", {
    params: { slug: "test-lip" },
  });
  let c = await call(cart.GET, "GET", "/cart", { cookies });
  c = await call(cartLines.POST, "POST", "/cart/lines", {
    cookies,
    body: {
      variantId: shop.lipBrownie.id,
      quantity: 1,
      expectedVersion: c.body.version,
    },
  });
  c = await call(cartLine.PATCH, "PATCH", `/cart/lines/${shop.lipBrownie.id}`, {
    cookies,
    params: { variantId: shop.lipBrownie.id },
    body: {
      replacementVariantId: shop.lipBrownie.id,
      expectedVersion: c.body.version,
    },
  });
  c = await call(cartLines.POST, "POST", "/cart/lines", {
    cookies,
    body: {
      variantId: shop.cleanser.id,
      quantity: 2,
      expectedVersion: c.body.version,
    },
  });
  c = await call(
    cartLine.DELETE,
    "DELETE",
    `/cart/lines/${shop.lipBrownie.id}`,
    {
      cookies,
      params: { variantId: shop.lipBrownie.id },
      body: { expectedVersion: c.body.version },
    },
  );
  const created = await call(checkouts.POST, "POST", "/checkouts", {
    cookies,
    body: { cartId: c.body.id, expectedCartVersion: c.body.version },
  });
  const checkoutId = String(created.body.id);
  await call(checkout.GET, "GET", `/checkouts/${checkoutId}`, {
    cookies,
    params: { checkoutId },
  });
  const patched = await call(
    checkout.PATCH,
    "PATCH",
    `/checkouts/${checkoutId}`,
    {
      cookies,
      params: { checkoutId },
      body: {
        expectedRevision: created.body.revision,
        recipient: {
          name: "Contract Recipient",
          phone: "+250788555111",
          landmark: "Blue gate",
        },
        destination: DEST_5KM,
        destinationConfirmed: "CUSTOMER_CONFIRMED",
      },
    },
  );
  const quote = await call(
    quotes.POST,
    "POST",
    `/checkouts/${checkoutId}/quotes`,
    {
      cookies,
      params: { checkoutId },
      body: { expectedRevision: patched.body.revision },
    },
  );
  await call(methods.GET, "GET", "/payment-methods", { cookies });
  const found = await call(places.GET, "GET", "/places?q=Kimironko", {
    cookies,
  });
  const placeId = String((found.body.items as Json[])[0]?.placeId);
  await call(place.GET, "GET", `/places/${placeId}`, {
    cookies,
    params: { placeId },
  });
  const started = await call(
    payments.POST,
    "POST",
    `/checkouts/${checkoutId}/payments`,
    {
      status: 202,
      cookies,
      params: { checkoutId },
      body: {
        expectedRevision: Number(patched.body.revision),
        quoteId: String(quote.body.id),
        acceptedTotalRwf: 30000 + Number(quote.body.amountRwf),
        method: "MTN_MOMO_RWA",
        payerPhone: "+250788123000",
      },
    },
  );
  const attemptId = String(started.body.id);
  await call(payment.GET, "GET", `/payments/${attemptId}`, {
    cookies,
    params: { attemptId },
  });
  await drainJobs();
  await settleAndDrain(6);
  const attempt = await db().paymentAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  return { cookies, orderId: attempt.orderId, attemptId, checkoutId };
}

describe("API contract conformance (v1.1)", () => {
  it("customer catalog, cart, checkout, quote, payment, order, private access and operations", async () => {
    const { cookies, orderId } = await purchase();
    const viewed = await call(order.GET, "GET", `/orders/${orderId}`, {
      cookies,
      params: { orderId },
    });
    expect(viewed.body.state).toBe("PAID");
    const link = await call(
      ownerLink.POST,
      "POST",
      `/orders/${orderId}/access-link`,
      { cookies, params: { orderId } },
    );
    const token = /#token=([A-Za-z0-9_-]+)/.exec(String(link.body.url))![1]!;
    const ex = await call(exchange.POST, "POST", "/order-access/exchange", {
      body: { token },
    });
    const orderSession = (
      ex.res as unknown as {
        cookies: { get(n: string): { value: string } | undefined };
      }
    ).cookies.get(orderCookieName(orderId))!.value;
    await call(order.GET, "GET", `/orders/${orderId}`, {
      cookies: { [orderCookieName(orderId)]: orderSession },
      params: { orderId },
    });
    const op = await call(
      cancellation.POST,
      "POST",
      `/orders/${orderId}/cancellation-requests`,
      {
        cookies,
        params: { orderId },
        body: {
          expectedVersion: viewed.body.version,
          reason: "Changed my mind",
        },
      },
    );
    await call(guestOperation.GET, "GET", `/operations/${op.body.id}`, {
      cookies,
      params: { operationId: String(op.body.id) },
    });
    // Error responses use the contract Error shape.
    await call(order.GET, "GET", `/orders/${randomUUID()}`, {
      status: 404,
      cookies,
      params: { orderId: randomUUID() },
    });
    await call(exchange.POST, "POST", "/order-access/exchange", {
      status: 404,
      body: { token },
    });
    await call(jobs.POST, "POST", "/internal/jobs/run", {
      bearer: process.env.WORKER_SECRET,
      body: { batchSize: 10, maxRuntimeSeconds: 5 },
    });
    expectConformance();
  });

  it("staff orders, fulfilment commands, access reissue, payments and refunds", async () => {
    const { orderId, attemptId } = await purchase();
    const admin = await staffHeader("ADMIN");
    const finance = await staffHeader("FINANCE");
    await call(me.GET, "GET", "/staff/me", { staff: admin });
    await call(staffOrders.GET, "GET", "/staff/orders?limit=10", {
      staff: admin,
    });
    let detail = await call(staffOrder.GET, "GET", `/staff/orders/${orderId}`, {
      staff: admin,
      params: { orderId },
    });
    // Finance sees the order with contact details masked (still contract-valid).
    await call(staffOrder.GET, "GET", `/staff/orders/${orderId}`, {
      staff: finance,
      params: { orderId },
    });
    detail = await call(
      commands.POST,
      "POST",
      `/staff/orders/${orderId}/commands`,
      {
        staff: admin,
        params: { orderId },
        body: {
          action: "START_PREPARATION",
          expectedVersion: detail.body.version,
          reason: "Packed",
        },
      },
    );
    await call(commands.POST, "POST", `/staff/orders/${orderId}/commands`, {
      status: 409,
      staff: admin,
      params: { orderId },
      body: { action: "HOLD", expectedVersion: 1, reason: "stale" },
    });
    const reissue = await call(
      accessLinks.POST,
      "POST",
      `/staff/orders/${orderId}/access-links`,
      {
        staff: admin,
        params: { orderId },
        body: {
          expectedVersion: detail.body.version,
          verificationCaseReference: "CASE-1",
          reason: "Lost link",
        },
      },
    );
    await call(
      staffOperation.GET,
      "GET",
      `/staff/operations/${reissue.body.id}`,
      { staff: admin, params: { operationId: String(reissue.body.id) } },
    );
    await call(
      paymentReconcile.POST,
      "POST",
      `/staff/payments/${attemptId}/reconcile`,
      {
        staff: finance,
        params: { attemptId },
        body: { reason: "Customer enquiry" },
      },
    );
    await call(exceptions.GET, "GET", "/staff/payment-exceptions", {
      staff: finance,
    });
    const rec = await call(receipts.GET, "GET", "/staff/receipts", {
      staff: finance,
    });
    const receipt = (rec.body.items as Json[])[0]!;
    const refund = await call(refunds.POST, "POST", "/staff/refunds", {
      staff: finance,
      body: {
        orderId,
        receiptId: receipt.id,
        amountRwf: 1000,
        reason: "Goodwill",
      },
    });
    const decided = await call(
      refundDecision.POST,
      "POST",
      `/staff/refunds/${refund.body.id}/decision`,
      {
        staff: finance,
        params: { refundId: String(refund.body.id) },
        body: {
          expectedVersion: refund.body.version,
          decision: "APPROVE",
          reason: "ok",
        },
      },
    );
    await call(
      refundReconcile.POST,
      "POST",
      `/staff/refunds/${decided.body.id}/reconcile`,
      {
        staff: finance,
        params: { refundId: String(decided.body.id) },
        body: { reason: "check" },
      },
    );
    await call(refunds.GET, "GET", "/staff/refunds", { staff: finance });
    const support = await staffHeader("SUPPORT");
    await call(
      refundDecision.POST,
      "POST",
      `/staff/refunds/${refund.body.id}/decision`,
      {
        status: 403,
        staff: support,
        params: { refundId: String(refund.body.id) },
        body: { expectedVersion: 1, decision: "APPROVE", reason: "x" },
      },
    );
    // CC-18: closing a finance review (the refund is flagged as if the provider's records differed).
    const refundId = String(decided.body.id);
    const reviewBody = (version: number) => ({
      expectedVersion: version,
      outcome: "AS_RECORDED",
      providerReference: null,
      reason: "Dashboard matches",
    });
    await call(
      refundReview.POST,
      "POST",
      `/staff/refunds/${refundId}/review-resolution`,
      {
        status: 409,
        staff: finance,
        params: { refundId },
        body: reviewBody(Number(decided.body.version)),
      },
    );
    const flagged = await db().refund.update({
      where: { id: refundId },
      data: { verificationFlag: "NEEDS_REVIEW", version: { increment: 1 } },
    });
    await call(
      refundReview.POST,
      "POST",
      `/staff/refunds/${refundId}/review-resolution`,
      {
        status: 403,
        staff: support,
        params: { refundId },
        body: reviewBody(flagged.version),
      },
    );
    await call(
      refundReview.POST,
      "POST",
      `/staff/refunds/${refundId}/review-resolution`,
      {
        staff: finance,
        params: { refundId },
        body: reviewBody(flagged.version),
      },
    );
    // The staff order with refund rows (CC-11/17/19 refund fields, provider ids) against the contract.
    const withRefunds = await call(
      staffOrder.GET,
      "GET",
      `/staff/orders/${orderId}`,
      { staff: finance, params: { orderId } },
    );
    expect((withRefunds.body.refunds as Json[]).length).toBeGreaterThan(0);
    expect(
      (withRefunds.body.receipts as Json[])[0]!.providerPaymentId,
    ).toBeTruthy();
    expectConformance();
  });

  it("staff catalog, media, stock and members", async () => {
    const admin = await staffHeader("ADMIN");
    await call(staffProducts.GET, "GET", "/staff/products", { staff: admin });
    const png = await sharp({
      create: {
        width: 600,
        height: 600,
        channels: 3,
        background: { r: 10, g: 120, b: 90 },
      },
    })
      .png()
      .toBuffer();
    const intent = await call(
      mediaIntents.POST,
      "POST",
      "/staff/media/upload-intents",
      {
        staff: admin,
        body: {
          purpose: "PRODUCT_PHOTO",
          mimeType: "image/png",
          sizeBytes: png.length,
        },
      },
    );
    const uploadId = String(intent.body.uploadId);
    await call(mediaContent.PUT, "PUT", `/staff/media/${uploadId}/content`, {
      staff: admin,
      params: { uploadId },
      raw: png,
      contentType: "image/png",
    });
    const fin = await call(
      mediaFinalize.POST,
      "POST",
      `/staff/media/${uploadId}/finalize`,
      { staff: admin, params: { uploadId }, body: { alt: "Jar front" } },
    );
    const category = await db().category.findUniqueOrThrow({
      where: { slug: "skincare" },
    });
    const draft = {
      title: "Contract Serum",
      slug: "contract-serum",
      brand: "Brand",
      categoryId: category.id,
      description: "Reviewed description.",
      variants: [
        {
          id: null,
          sku: "CON-SERUM",
          attributes: { size: "30 ml" },
          priceRwf: 9000,
          isActive: true,
        },
      ],
      media: [
        {
          storageKey: fin.body.storageKey,
          alt: "Jar front",
          variantId: null,
          sortOrder: 0,
        },
      ],
      contentReviewed: true,
      imageRightsConfirmed: true,
      isSynthetic: false,
    };
    const created = await call(staffProducts.POST, "POST", "/staff/products", {
      staff: admin,
      body: draft,
    });
    const productId = String((created.body.product as Json).id);
    await call(staffProduct.GET, "GET", `/staff/products/${productId}`, {
      staff: admin,
      params: { productId },
    });
    await call(staffProduct.PUT, "PUT", `/staff/products/${productId}`, {
      staff: admin,
      params: { productId },
      body: {
        expectedVersion: created.body.version,
        draft: { ...draft, title: "Contract Serum 30 ml" },
      },
    });
    const preview = await call(
      importPreviews.POST,
      "POST",
      "/staff/inventory/import-previews",
      {
        staff: admin,
        body: {
          rows: [
            {
              sku: "CON-SERUM",
              quantityOnHand: 5,
              ownership: "OWNED",
              supplierId: null,
              agreementReference: null,
              batchReference: "B-1",
              expiryDate: "2028-01-31",
              unitCostRwf: null,
            },
          ],
        },
      },
    );
    await call(
      importApply.POST,
      "POST",
      `/staff/inventory/import-previews/${preview.body.id}/apply`,
      {
        staff: admin,
        params: { previewId: String(preview.body.id) },
        body: { sourceHash: preview.body.sourceHash, reason: "Opening count" },
      },
    );
    const lots = await call(
      inventory.GET,
      "GET",
      "/staff/inventory?sku=CON-SERUM",
      { staff: admin },
    );
    const lot = (lots.body.items as Json[])[0]!;
    await call(adjustments.POST, "POST", "/staff/inventory/adjustments", {
      staff: admin,
      body: {
        lotId: lot.id,
        expectedVersion: lot.version,
        quantityDelta: -1,
        reason: "Damaged",
        reference: "D-1",
      },
    });
    const current = await db().product.findUniqueOrThrow({
      where: { id: productId },
    });
    await call(
      publication.POST,
      "POST",
      `/staff/products/${productId}/publication`,
      {
        staff: admin,
        params: { productId },
        body: {
          expectedVersion: current.version,
          state: "PUBLISHED",
          reason: "Launch",
        },
      },
    );
    const list = await call(members.GET, "GET", "/staff/members", {
      staff: admin,
    });
    const other =
      (list.body.items as Json[]).find(
        (m) => m.displayName !== "Contract ADMIN",
      ) ?? (list.body.items as Json[])[0]!;
    if (other.displayName !== "Contract ADMIN") {
      await call(member.PATCH, "PATCH", `/staff/members/${other.id}`, {
        staff: admin,
        params: { memberId: String(other.id) },
        body: {
          expectedVersion: other.version,
          role: "SUPPORT",
          isActive: true,
          reason: "Role change",
        },
      });
    }
    await staffHeader("SUPPORT");
    const list2 = await call(members.GET, "GET", "/staff/members", {
      staff: admin,
    });
    const supportMember = (list2.body.items as Json[]).find(
      (m) => m.role === "SUPPORT",
    )!;
    await call(member.PATCH, "PATCH", `/staff/members/${supportMember.id}`, {
      staff: admin,
      params: { memberId: String(supportMember.id) },
      body: {
        expectedVersion: supportMember.version,
        role: "OPERATIONS",
        isActive: true,
        reason: "Role change",
      },
    });
    expectConformance();
  });

  it("suppliers, obligations, settlement and settings", async () => {
    const { orderId } = await purchase(); // the cleanser comes from the consigned lot first (FEFO)
    const admin = await staffHeader("ADMIN");
    const adminRow = await db().staffMember.findFirstOrThrow({
      where: { displayName: "Contract ADMIN" },
    });
    const actor = {
      staffId: adminRow.id,
      authUserId: adminRow.authUserId,
      role: adminRow.role,
      displayName: adminRow.displayName,
      email: adminRow.email,
      roleVersion: adminRow.roleVersion,
    };
    for (const cmd of [
      { action: "START_PREPARATION", reason: "Packed" },
      { action: "ASSIGN_RIDER", reason: "Booked", riderReference: "R1" },
      {
        action: "HAND_OVER",
        reason: "Collected",
        riderReference: "R1",
        occurredAt: new Date().toISOString(),
      },
    ]) {
      const { version } = await db().order.findUniqueOrThrow({
        where: { id: orderId },
      });
      await applyOrderCommand(
        actor,
        orderId,
        { ...cmd, expectedVersion: version } as OrderCommand,
        `test-${randomUUID()}`,
        null,
      );
    }
    const created = await call(
      suppliersRoute.POST,
      "POST",
      "/staff/suppliers",
      {
        status: 201,
        staff: admin,
        body: { name: "Contract Supplier", agreementReference: "AGR-1" },
      },
    );
    await call(
      supplierRoute.PATCH,
      "PATCH",
      `/staff/suppliers/${created.body.id}`,
      {
        staff: admin,
        params: { supplierId: String(created.body.id) },
        body: {
          expectedVersion: 1,
          name: "Contract Supplier Ltd",
          agreementReference: "AGR-2",
          isActive: true,
          reason: "Rename",
        },
      },
    );
    await call(suppliersRoute.GET, "GET", "/staff/suppliers", { staff: admin });
    const obligations = await call(
      obligationsRoute.GET,
      "GET",
      "/staff/supplier-obligations",
      { staff: admin },
    );
    const ob = (obligations.body.items as Json[])[0]!;
    await call(
      settlementRoute.POST,
      "POST",
      `/staff/supplier-obligations/${ob.id}/settlement`,
      {
        staff: admin,
        params: { obligationId: String(ob.id) },
        body: {
          expectedVersion: ob.version,
          manualReference: "BANK-1",
          reason: "Settled off-platform",
        },
      },
    );
    const current = await call(settingsRoute.GET, "GET", "/staff/settings", {
      staff: admin,
    });
    const { version: _v, ...editable } = current.body;
    await call(settingsRoute.PUT, "PUT", "/staff/settings", {
      staff: admin,
      body: {
        expectedVersion: current.body.version,
        settings: {
          ...editable,
          version: current.body.version,
          quoteTtlSeconds: 600,
        },
        reason: "Shorter quotes",
      },
    });
    expectConformance();
  });

  it("pre-launch wall and launch list (CC-20)", async () => {
    const saved = {
      LAUNCH_LIST: process.env.LAUNCH_LIST,
      LAUNCH_LIST_CONTACT_EMAIL: process.env.LAUNCH_LIST_CONTACT_EMAIL,
      SITE_GATE: process.env.SITE_GATE,
      SITE_ACCESS_CODE_HASH: process.env.SITE_ACCESS_CODE_HASH,
    };
    const set = (values: Record<string, string | undefined>) => {
      for (const [k, v] of Object.entries(values)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetServerEnvForTests();
    };
    try {
      set({
        LAUNCH_LIST: "closed",
        SITE_GATE: "off",
        SITE_ACCESS_CODE_HASH: undefined,
      });
      await call(launchListRoute.POST, "POST", "/launch-list", {
        status: 409,
        body: { email: "contract@example.test", consent: true },
      });
      await call(siteAccessRoute.POST, "POST", "/site-access", {
        body: { code: "anything", next: "/shop" },
      });
      set({
        LAUNCH_LIST: "open",
        LAUNCH_LIST_CONTACT_EMAIL: "hello@beautyboxmarket.test",
        SITE_GATE: "on",
        SITE_ACCESS_CODE_HASH: await hashAccessCode("Contract-Code-1"),
      });
      await call(launchListRoute.POST, "POST", "/launch-list", {
        status: 202,
        body: {
          email: "contract@example.test",
          phone: "0788123456",
          consent: true,
        },
      });
      await call(launchListRoute.POST, "POST", "/launch-list", {
        status: 422,
        body: { consent: true },
      });
      await call(siteAccessRoute.POST, "POST", "/site-access", {
        status: 401,
        body: { code: "wrong-code" },
      });
      const right = await call(siteAccessRoute.POST, "POST", "/site-access", {
        body: { code: "Contract-Code-1", next: "https://evil.example" },
      });
      expect(right.body.next).toBe("/");
    } finally {
      set(saved);
    }
    expectConformance();
  });

  it("covers every implemented operation", () => {
    // Operations not yet implemented are listed explicitly so the gap stays visible.
    // The provider callback has its own signed-body tests (payments.test.ts); its wire format
    // belongs to the provider, not this contract.
    const NOT_YET = ["POST /callbacks/pawapay"];
    const all = Object.entries(contract.paths).flatMap(([p, ops]) =>
      Object.keys(ops)
        .filter((m) => m !== "parameters")
        .map((m) => `${m.toUpperCase()} ${p}`),
    );
    const missing = all.filter(
      (op) => !checked.has(op) && !NOT_YET.includes(op),
    );
    expect(missing).toEqual([]);
  });
});
