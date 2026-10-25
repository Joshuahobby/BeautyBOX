import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { db } from "@/server/db";
import { getProductBySlug } from "@/modules/catalog/catalog";
import { POST as postIntent } from "@/app/api/v1/staff/media/upload-intents/route";
import { PUT as putContent } from "@/app/api/v1/staff/media/[uploadId]/content/route";
import { POST as postFinalize } from "@/app/api/v1/staff/media/[uploadId]/finalize/route";
import { GET as getMedia } from "@/app/media/[...key]/route";
import { POST as postProduct } from "@/app/api/v1/staff/products/route";
import { POST as postPublication } from "@/app/api/v1/staff/products/[productId]/publication/route";
import { POST as postImportPreview } from "@/app/api/v1/staff/inventory/import-previews/route";
import { POST as postImportApply } from "@/app/api/v1/staff/inventory/import-previews/[previewId]/apply/route";
import { resetDatabase, seedShop } from "./harness";

// I08 photo upload (contract createMediaUploadIntent / finalizeMedia) with the local
// storage adapter: the server decodes the real bytes, rejects spoofed or unusable files,
// strips metadata into a WebP derivative and serves only approved photos publicly.

beforeEach(async () => {
  await resetDatabase();
  await seedShop();
});

type Role = "ADMIN" | "OPERATIONS" | "FINANCE" | "SUPPORT";
async function staff(role: Role) {
  const authUserId = randomUUID();
  const m = await db().staffMember.create({ data: { authUserId, email: `${role.toLowerCase()}-${authUserId.slice(0, 6)}@example.test`, displayName: `Test ${role}`, role } });
  return { ...m, header: `${authUserId}:aal2` };
}

const origin = () => process.env.APP_ORIGIN!;
const params = <P extends Record<string, string | string[]>>(p: P) => ({ params: Promise.resolve(p) });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

function jsonReq(method: string, path: string, as: string | null, body?: unknown) {
  const headers: Record<string, string> = { origin: origin(), "content-type": "application/json", "idempotency-key": `test-${randomUUID()}` };
  if (as) headers["x-test-staff"] = as;
  return new NextRequest(`${origin()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function bytesReq(path: string, as: string, bytes: Buffer, contentType: string) {
  return new NextRequest(`${origin()}${path}`, { method: "PUT", headers: { origin: origin(), "content-type": contentType, "x-test-staff": as }, body: new Uint8Array(bytes) });
}

const image = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 140 } } });

async function upload(as: string, bytes: Buffer, declared: "image/jpeg" | "image/png" | "image/webp", alt = "Front of the bottle") {
  const intent = await json(await postIntent(jsonReq("POST", "/api/v1/staff/media/upload-intents", as, { purpose: "PRODUCT_PHOTO", mimeType: declared, sizeBytes: bytes.length }), params({})));
  expect(intent.status).toBe(200);
  const uploadId = String(intent.body.uploadId);
  expect(String(intent.body.uploadUrl)).toBe(`${origin()}/api/v1/staff/media/${uploadId}/content`);
  const put = await putContent(bytesReq(`/api/v1/staff/media/${uploadId}/content`, as, bytes, declared), params({ uploadId }));
  expect(put.status).toBe(200);
  const fin = await json(await postFinalize(jsonReq("POST", `/api/v1/staff/media/${uploadId}/finalize`, as, { alt }), params({ uploadId })));
  return { uploadId, ...fin };
}

describe("product photo upload", () => {
  it("stores a metadata-free WebP derivative under a new immutable key", async () => {
    const ops = await staff("OPERATIONS");
    const jpeg = await image(2400, 1200).jpeg().withMetadata({ exif: { IFD0: { Copyright: "private-owner-name" } } }).toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const result = await upload(ops.header, jpeg, "image/jpeg");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ reviewState: "PENDING_REVIEW", width: 1600, height: 800, rejectReason: null });
    const key = String(result.body.storageKey);
    expect(key).toMatch(/^products\/[0-9a-f-]{36}\.webp$/);

    // Awaiting review: staff can preview it, the public cannot.
    const anonymous = await getMedia(new NextRequest(`${origin()}/media/${key}`), params({ key: key.split("/") }));
    expect(anonymous.status).toBe(401);
    const preview = await getMedia(new NextRequest(`${origin()}/media/${key}`, { headers: { "x-test-staff": ops.header } }), params({ key: key.split("/") }));
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toBe("private, no-store");
    const stored = Buffer.from(await preview.arrayBuffer());
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();

    // Finalizing again returns the same result; nothing new is written.
    const again = await json(await postFinalize(jsonReq("POST", `/api/v1/staff/media/${result.uploadId}/finalize`, ops.header, { alt: "x" }), params({ uploadId: result.uploadId })));
    expect(again.body.storageKey).toBe(key);
  });

  it("rejects spoofed types, tiny images and non-images", async () => {
    const ops = await staff("OPERATIONS");
    const png = await image(600, 600).png().toBuffer();
    expect((await upload(ops.header, png, "image/jpeg")).body).toMatchObject({ reviewState: "REJECTED", rejectReason: "The file is not the image type it claims to be." });
    expect((await upload(ops.header, await image(120, 120).png().toBuffer(), "image/png")).body.reviewState).toBe("REJECTED");
    expect((await upload(ops.header, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/png")).body.reviewState).toBe("REJECTED");
    expect(await db().mediaUpload.count({ where: { state: "REJECTED" } })).toBe(3);
    expect(await db().mediaUpload.count({ where: { state: "FINALIZED" } })).toBe(0);
  });

  it("refuses SVG, oversize declarations, mismatched content types, other people's uploads and roles without catalog access", async () => {
    const ops = await staff("OPERATIONS");
    const other = await staff("OPERATIONS");
    const support = await staff("SUPPORT");
    expect((await postIntent(jsonReq("POST", "/api/v1/staff/media/upload-intents", ops.header, { purpose: "PRODUCT_PHOTO", mimeType: "image/svg+xml", sizeBytes: 100 }), params({}))).status).toBe(422);
    expect((await postIntent(jsonReq("POST", "/api/v1/staff/media/upload-intents", ops.header, { purpose: "PRODUCT_PHOTO", mimeType: "image/png", sizeBytes: 10_000_001 }), params({}))).status).toBe(422);
    expect((await postIntent(jsonReq("POST", "/api/v1/staff/media/upload-intents", support.header, { purpose: "PRODUCT_PHOTO", mimeType: "image/png", sizeBytes: 100 }), params({}))).status).toBe(403);
    expect((await postIntent(jsonReq("POST", "/api/v1/staff/media/upload-intents", null, { purpose: "PRODUCT_PHOTO", mimeType: "image/png", sizeBytes: 100 }), params({}))).status).toBe(401);

    const png = await image(600, 600).png().toBuffer();
    const intent = await json(await postIntent(jsonReq("POST", "/api/v1/staff/media/upload-intents", ops.header, { purpose: "PRODUCT_PHOTO", mimeType: "image/png", sizeBytes: png.length }), params({})));
    const uploadId = String(intent.body.uploadId);
    expect((await putContent(bytesReq(`/api/v1/staff/media/${uploadId}/content`, ops.header, png, "image/jpeg"), params({ uploadId }))).status).toBe(422);
    expect((await putContent(bytesReq(`/api/v1/staff/media/${uploadId}/content`, ops.header, Buffer.concat([png, Buffer.alloc(10)]), "image/png"), params({ uploadId }))).status).toBe(422);
    expect((await putContent(bytesReq(`/api/v1/staff/media/${uploadId}/content`, other.header, png, "image/png"), params({ uploadId }))).status).toBe(404);
    expect((await postFinalize(jsonReq("POST", `/api/v1/staff/media/${uploadId}/finalize`, other.header, { alt: "x" }), params({ uploadId }))).status).toBe(404);
  });

  it("a verified product with an uploaded, reviewed photo and counted stock publishes, and its photo becomes public", async () => {
    const ops = await staff("OPERATIONS");
    const photo = await upload(ops.header, await image(1000, 1000).webp().toBuffer(), "image/webp", "Verified Serum bottle, front label");
    const key = String(photo.body.storageKey);
    const category = await db().category.findUniqueOrThrow({ where: { slug: "skincare" } });
    const created = await json(
      await postProduct(
        jsonReq("POST", "/api/v1/staff/products", ops.header, {
          title: "Verified Serum",
          slug: "verified-serum",
          brand: "Real Brand",
          categoryId: category.id,
          description: "Description reviewed against the packaging.",
          variants: [{ id: null, sku: "VER-SERUM-30", attributes: { size: "30 ml" }, priceRwf: 18000, isActive: true }],
          media: [{ storageKey: key, alt: "Verified Serum bottle, front label", variantId: null, sortOrder: 0 }],
          contentReviewed: true,
          imageRightsConfirmed: true,
          isSynthetic: false,
        }),
        params({}),
      ),
    );
    expect(created.status).toBe(201);
    expect(created.body.publicationErrors).toEqual(["NO_VERIFIED_STOCK"]);
    const productId = (created.body.product as { id: string }).id;

    const preview = await json(
      await postImportPreview(
        jsonReq("POST", "/api/v1/staff/inventory/import-previews", ops.header, {
          rows: [{ sku: "VER-SERUM-30", quantityOnHand: 12, ownership: "OWNED", supplierId: null, agreementReference: null, batchReference: "B-2026-10", expiryDate: "2028-01-31", unitCostRwf: null }],
        }),
        params({}),
      ),
    );
    const previewId = String(preview.body.id);
    await postImportApply(jsonReq("POST", `/api/v1/staff/inventory/import-previews/${previewId}/apply`, ops.header, { sourceHash: preview.body.sourceHash, reason: "Opening count" }), params({ previewId }));
    const current = await db().product.findUniqueOrThrow({ where: { id: productId } });
    const published = await json(await postPublication(jsonReq("POST", `/api/v1/staff/products/${productId}/publication`, ops.header, { expectedVersion: current.version, state: "PUBLISHED", reason: "Launch" }), params({ productId })));
    expect(published.status).toBe(200);

    const product = await getProductBySlug("verified-serum");
    expect(product?.images[0]).toEqual({ url: `${origin()}/media/${key}`, alt: "Verified Serum bottle, front label" });
    const pub = await getMedia(new NextRequest(`${origin()}/media/${key}`), params({ key: key.split("/") }));
    expect(pub.status).toBe(200);
    expect(pub.headers.get("cache-control")).toBe("public, max-age=600");
    // Path tricks and unknown keys are simply not found.
    expect((await getMedia(new NextRequest(`${origin()}/media/x`), params({ key: ["..", "..", ".env.local"] }))).status).toBe(404);
  });
});
