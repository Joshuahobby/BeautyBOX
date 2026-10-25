import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { db } from "@/server/db";
import { mediaStorage } from "@/adapters/registry";
import { can } from "@/modules/staff/capabilities";
import { getProductBySlug } from "@/modules/catalog/catalog";
import { GET as getMe } from "@/app/api/v1/staff/me/route";
import { POST as postProduct } from "@/app/api/v1/staff/products/route";
import { POST as postPublication } from "@/app/api/v1/staff/products/[productId]/publication/route";
import { POST as postAdjustment } from "@/app/api/v1/staff/inventory/adjustments/route";
import { POST as postImportPreview } from "@/app/api/v1/staff/inventory/import-previews/route";
import { POST as postImportApply } from "@/app/api/v1/staff/inventory/import-previews/[previewId]/apply/route";
import { PATCH as patchMember } from "@/app/api/v1/staff/members/[memberId]/route";
import { addToCart, ledgerMismatches, newCustomer, pay, readyCheckout, resetDatabase, seedShop, type Shop } from "./harness";

// I08: staff identity, roles, catalog drafts/publication, stock adjustment and import,
// exercised through the real route handlers with the TEST identity provider.

let shop: Shop;
beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
});

type Role = "ADMIN" | "OPERATIONS" | "FINANCE" | "SUPPORT";

async function staff(role: Role, isActive = true) {
  const authUserId = randomUUID();
  const member = await db().staffMember.create({
    data: { authUserId, email: `${role.toLowerCase()}-${authUserId.slice(0, 6)}@example.test`, displayName: `Test ${role}`, role, isActive },
  });
  return { ...member, header: `${authUserId}:aal2`, aal1: `${authUserId}:aal1` };
}

function req(method: string, path: string, opts: { as?: string; body?: unknown } = {}) {
  const origin = process.env.APP_ORIGIN!;
  const headers: Record<string, string> = { origin };
  if (opts.as) headers["x-test-staff"] = opts.as;
  if (method !== "GET") {
    headers["content-type"] = "application/json";
    headers["idempotency-key"] = `test-${randomUUID()}`;
  }
  return new NextRequest(`${origin}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

const params = <P extends Record<string, string>>(p: P) => ({ params: Promise.resolve(p) });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

async function draftBody(overrides: Record<string, unknown> = {}) {
  const category = await db().category.findUniqueOrThrow({ where: { slug: "skincare" } });
  return {
    title: "Verified Serum",
    slug: "verified-serum",
    brand: "Real Brand",
    categoryId: category.id,
    description: "Description reviewed against the packaging.",
    variants: [{ id: null, sku: "VER-SERUM-30", attributes: { size: "30 ml" }, priceRwf: 18000, isActive: true }],
    media: [],
    contentReviewed: true,
    imageRightsConfirmed: true,
    isSynthetic: false,
    ...overrides,
  };
}

describe("T16 staff identity and roles", () => {
  it("denies missing sessions, aal1 sessions, non-staff and disabled staff - and audits denials", async () => {
    expect((await getMe(req("GET", "/api/v1/staff/me"), params({}))).status).toBe(401);
    const ops = await staff("OPERATIONS");
    expect((await getMe(req("GET", "/api/v1/staff/me", { as: ops.aal1 }), params({}))).status).toBe(403);
    expect((await getMe(req("GET", "/api/v1/staff/me", { as: `${randomUUID()}:aal2` }), params({}))).status).toBe(403);
    const ok = await json(await getMe(req("GET", "/api/v1/staff/me", { as: ops.header }), params({})));
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe("OPERATIONS");

    // Disabling takes effect on the very next request, even with a still-valid session token.
    await db().staffMember.update({ where: { id: ops.id }, data: { isActive: false } });
    expect((await getMe(req("GET", "/api/v1/staff/me", { as: ops.header }), params({}))).status).toBe(403);
    expect(await db().auditEvent.count({ where: { action: "DISABLED_STAFF_DENIED" } })).toBe(1);
  });

  it("enforces capabilities server-side and audits the denial", async () => {
    const support = await staff("SUPPORT");
    const lot = await db().inventoryLot.findFirstOrThrow({ where: { variantId: shop.cleanser.id } });
    const res = await postAdjustment(
      req("POST", "/api/v1/staff/inventory/adjustments", { as: support.header, body: { lotId: lot.id, expectedVersion: lot.version, quantityDelta: -1, reason: "Damaged", reference: "D-1" } }),
      params({}),
    );
    expect(res.status).toBe(403);
    expect(await db().auditEvent.count({ where: { action: "CAPABILITY_DENIED", actorId: support.id } })).toBe(1);
    // Refund approval is restricted to ADMIN/FINANCE (decisions addendum).
    expect(can("SUPPORT", "refunds.approve")).toBe(false);
    expect(can("OPERATIONS", "refunds.approve")).toBe(false);
    expect(can("FINANCE", "refunds.approve")).toBe(true);
    expect(can("SUPPORT", "refunds.request")).toBe(true);
    expect(can("FINANCE", "staff.manage")).toBe(false);
  });

  it("rejects mutations from a foreign origin before doing anything", async () => {
    const ops = await staff("OPERATIONS");
    const bad = new NextRequest(`${process.env.APP_ORIGIN}/api/v1/staff/products`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json", "idempotency-key": `test-${randomUUID()}`, "x-test-staff": ops.header },
      body: JSON.stringify(await draftBody()),
    });
    expect((await postProduct(bad, params({}))).status).toBe(403);
    expect(await db().product.count({ where: { slug: "verified-serum" } })).toBe(0);
  });

  it("never removes the last active administrator", async () => {
    const admin = await staff("ADMIN");
    const res = await json(
      await patchMember(
        req("PATCH", `/api/v1/staff/members/${admin.id}`, { as: admin.header, body: { expectedVersion: admin.version, role: "ADMIN", isActive: false, reason: "leaving" } }),
        params({ memberId: admin.id }),
      ),
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACTION_NOT_ALLOWED");
  });
});

describe("catalog drafts and publication (CAT-01..03, T23)", () => {
  it("creates a draft, rejects a duplicate SKU, and reports why it cannot be published yet", async () => {
    const ops = await staff("OPERATIONS");
    const created = await json(await postProduct(req("POST", "/api/v1/staff/products", { as: ops.header, body: await draftBody() }), params({})));
    expect(created.status).toBe(201);
    expect(created.body.publishState).toBe("DRAFT");
    expect(created.body.publicationErrors).toEqual(expect.arrayContaining(["NO_APPROVED_PHOTO", "NO_VERIFIED_STOCK"]));

    const dup = await json(
      await postProduct(
        req("POST", "/api/v1/staff/products", { as: ops.header, body: await draftBody({ slug: "another", variants: [{ id: null, sku: "T-CLEANSER", attributes: {}, priceRwf: 1000, isActive: true }] }) }),
        params({}),
      ),
    );
    expect(dup.status).toBe(422);

    const product = created.body as { product: { id: string }; version: number };
    const publish = await json(
      await postPublication(
        req("POST", `/api/v1/staff/products/${product.product.id}/publication`, { as: ops.header, body: { expectedVersion: product.version, state: "PUBLISHED", reason: "launch" } }),
        params({ productId: product.product.id }),
      ),
    );
    expect(publish.status).toBe(409);
    expect(publish.body.code).toBe("PUBLICATION_BLOCKED");
    expect(await getProductBySlug("verified-serum")).toBeNull();
  });

  it("T23: synthetic and reference records can never be published through staff tools", async () => {
    const ops = await staff("OPERATIONS");
    const synthetic = await json(await postProduct(req("POST", "/api/v1/staff/products", { as: ops.header, body: await draftBody({ isSynthetic: true, slug: "synthetic-serum", variants: [{ id: null, sku: "SYN-SERUM", attributes: {}, priceRwf: 1000, isActive: true }] }) }), params({})));
    expect(synthetic.body.publicationErrors).toContain("SYNTHETIC_RECORD");
    // The seeded demo product (synthetic) cannot be (re)published either.
    const demo = await db().product.findFirstOrThrow({ where: { slug: "draft-item" } });
    const res = await json(
      await postPublication(
        req("POST", `/api/v1/staff/products/${demo.id}/publication`, { as: ops.header, body: { expectedVersion: demo.version, state: "PUBLISHED", reason: "try" } }),
        params({ productId: demo.id }),
      ),
    );
    expect(res.status).toBe(409);
  });

  it("publishes a verified product only after reviewed photo and counted stock exist", async () => {
    const ops = await staff("OPERATIONS");
    // A finalized photo whose derivative really is in storage: publishing makes it public (DR-041).
    const storageKey = `products/${randomUUID()}.webp`;
    await mediaStorage().putPrivate(storageKey, await sharp({ create: { width: 800, height: 800, channels: 3, background: "#aab" } }).webp().toBuffer(), "image/webp");
    const upload = await db().mediaUpload.create({
      data: { purpose: "PRODUCT_PHOTO", declaredMimeType: "image/jpeg", declaredBytes: 1000, stagingKey: `staging/${randomUUID()}`, storageKey, state: "FINALIZED", width: 800, height: 800, createdByStaffId: ops.id, expiresAt: new Date(Date.now() + 3600_000) },
    });
    const created = await json(
      await postProduct(req("POST", "/api/v1/staff/products", { as: ops.header, body: await draftBody({ media: [{ storageKey: upload.storageKey, alt: "Verified Serum bottle, front label", variantId: null, sortOrder: 0 }] }) }), params({})),
    );
    const productId = (created.body.product as { id: string }).id;
    expect(created.body.publicationErrors).toEqual(["NO_VERIFIED_STOCK"]);

    // Opening stock arrives through a validated import preview.
    const preview = await json(
      await postImportPreview(
        req("POST", "/api/v1/staff/inventory/import-previews", {
          as: ops.header,
          body: { rows: [{ sku: "VER-SERUM-30", quantityOnHand: 12, ownership: "OWNED", supplierId: null, agreementReference: null, batchReference: "B-2026-10", expiryDate: "2028-01-31", unitCostRwf: null }] },
        }),
        params({}),
      ),
    );
    expect(preview.status).toBe(201);
    expect(preview.body.state).toBe("READY");
    const previewId = preview.body.id as string;
    const wrongHash = await postImportApply(req("POST", `/api/v1/staff/inventory/import-previews/${previewId}/apply`, { as: ops.header, body: { sourceHash: "0".repeat(64), reason: "count" } }), params({ previewId }));
    expect(wrongHash.status).toBe(409);
    const applied = await json(
      await postImportApply(req("POST", `/api/v1/staff/inventory/import-previews/${previewId}/apply`, { as: ops.header, body: { sourceHash: preview.body.sourceHash, reason: "Opening count 2026-10-21" } }), params({ previewId })),
    );
    expect(applied.body.state).toBe("APPLIED");
    expect(await ledgerMismatches()).toBe(0);

    const current = await db().product.findUniqueOrThrow({ where: { id: productId } });
    const published = await json(
      await postPublication(req("POST", `/api/v1/staff/products/${productId}/publication`, { as: ops.header, body: { expectedVersion: current.version, state: "PUBLISHED", reason: "Launch" } }), params({ productId })),
    );
    expect(published.status).toBe(200);
    expect(published.body.publishState).toBe("PUBLISHED");
    const publicView = await getProductBySlug("verified-serum");
    expect(publicView?.variants[0]?.isAvailable).toBe(true);
    expect(publicView?.images[0]?.url).toMatch(/^https?:\/\//);
  });
});

describe("stock import validation and adjustments (CAT-05, T18)", () => {
  it("rejects demo SKUs, duplicate lots, expired stock and consigned rows without supplier", async () => {
    const ops = await staff("OPERATIONS");
    const res = await json(
      await postImportPreview(
        req("POST", "/api/v1/staff/inventory/import-previews", {
          as: ops.header,
          body: {
            rows: [
              { sku: "T-CLEANSER", quantityOnHand: 5, ownership: "OWNED", supplierId: null, agreementReference: null, batchReference: "X1", expiryDate: null, unitCostRwf: null },
              { sku: "NO-SUCH-SKU", quantityOnHand: 5, ownership: "OWNED", supplierId: null, agreementReference: null, batchReference: "X2", expiryDate: null, unitCostRwf: null },
              { sku: "T-LAST", quantityOnHand: 1, ownership: "CONSIGNED", supplierId: null, agreementReference: null, batchReference: "X3", expiryDate: "2020-01-01", unitCostRwf: null },
            ],
          },
        }),
        params({}),
      ),
    );
    expect(res.body.state).toBe("INVALID");
    const messages = (res.body.errors as { row: number; field: string; message: string }[]).map((e) => `${e.row}:${e.field}`);
    expect(messages).toEqual(expect.arrayContaining(["1:sku", "2:sku", "3:supplierId", "3:agreementReference", "3:expiryDate"]));
  });

  it("T18: an adjustment cannot consume reserved or committed units; reasons and references are required", async () => {
    const ops = await staff("OPERATIONS");
    const c = await newCustomer();
    await addToCart(c, shop.last.id, 1);
    await pay(c, await readyCheckout(c)); // reserves the only unit
    const lot = await db().inventoryLot.findFirstOrThrow({ where: { variantId: shop.last.id } });
    const consume = await json(
      await postAdjustment(req("POST", "/api/v1/staff/inventory/adjustments", { as: ops.header, body: { lotId: lot.id, expectedVersion: lot.version, quantityDelta: -1, reason: "Offline sale", reference: "SALE-1" } }), params({})),
    );
    expect(consume.status).toBe(409);
    expect(consume.body.code).toBe("ACTION_NOT_ALLOWED");
    const add = await json(
      await postAdjustment(req("POST", "/api/v1/staff/inventory/adjustments", { as: ops.header, body: { lotId: lot.id, expectedVersion: lot.version, quantityDelta: 2, reason: "Recount found extra", reference: "COUNT-7" } }), params({})),
    );
    expect(add.status).toBe(200);
    expect(add.body.onHand).toBe(3);
    expect(add.body.available).toBe(2);
    const zero = await postAdjustment(req("POST", "/api/v1/staff/inventory/adjustments", { as: ops.header, body: { lotId: lot.id, expectedVersion: (add.body.version as number), quantityDelta: 0, reason: "nothing", reference: "Z" } }), params({}));
    expect(zero.status).toBe(422);
    const movement = await db().inventoryMovement.findFirstOrThrow({ where: { type: "ADJUSTMENT" } });
    expect(movement.actorId).toBe(ops.id);
    expect(movement.reason).toContain("COUNT-7");
    expect(await ledgerMismatches()).toBe(0);
  });
});
