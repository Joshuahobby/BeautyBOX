import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { db, transaction } from "@/server/db";
import { mediaStorage, setAdaptersForTests } from "@/adapters/registry";
import type { LocalMediaStorage } from "@/adapters/storage/local";
import type { MediaStorage } from "@/adapters/storage/types";
import { enqueuePublicSync } from "@/modules/media/publication";
import { runDueJobs } from "@/modules/jobs/worker";
import { clearSpentStagingUploads, STAGING_CLEAR_AFTER_SECONDS } from "@/modules/media/staging-cleanup";
import { INTENT_TTL_SECONDS } from "@/modules/media/uploads";
import { runStorageHousekeepingSafely } from "@/modules/ops/housekeeping";
import { POST as postJobsRun } from "@/app/api/v1/internal/jobs/run/route";
import { POST as postIntent } from "@/app/api/v1/staff/media/upload-intents/route";
import { PUT as putContent } from "@/app/api/v1/staff/media/[uploadId]/content/route";
import { POST as postFinalize } from "@/app/api/v1/staff/media/[uploadId]/finalize/route";
import { POST as postProduct } from "@/app/api/v1/staff/products/route";
import { PUT as putProduct } from "@/app/api/v1/staff/products/[productId]/route";
import { POST as postPublication } from "@/app/api/v1/staff/products/[productId]/publication/route";
import { POST as postImportPreview } from "@/app/api/v1/staff/inventory/import-previews/route";
import { POST as postImportApply } from "@/app/api/v1/staff/inventory/import-previews/[previewId]/apply/route";
import { advanceSeconds, resetDatabase, seedShop } from "./harness";

// DR-041: a product photo has a public copy exactly while it is approved. Approval and
// removal are applied right after the save, a durable MEDIA_PUBLIC_SYNC job backs that up
// and converges on the latest state, and publication waits until the photos are public.
// Runs against the real database with the local storage adapter (same interface as
// Supabase Storage; the Supabase adapter itself is exercised in storage-supabase.test.ts).

beforeEach(async () => {
  await resetDatabase();
  await seedShop();
});
afterEach(() => setAdaptersForTests({}));

const origin = () => process.env.APP_ORIGIN!;
const params = <P extends Record<string, string | string[]>>(p: P) => ({ params: Promise.resolve(p) });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });
const local = () => mediaStorage() as LocalMediaStorage;

async function staff() {
  const authUserId = randomUUID();
  await db().staffMember.create({ data: { authUserId, email: `ops-${authUserId.slice(0, 6)}@example.test`, displayName: "Test OPERATIONS", role: "OPERATIONS" } });
  return `${authUserId}:aal2`;
}

function jsonReq(method: string, path: string, as: string, body?: unknown) {
  const headers: Record<string, string> = { origin: origin(), "content-type": "application/json", "idempotency-key": `test-${randomUUID()}`, "x-test-staff": as };
  return new NextRequest(`${origin()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function uploadPhoto(as: string): Promise<string> {
  const bytes = await sharp({ create: { width: 800, height: 800, channels: 3, background: { r: 90, g: 140, b: 200 } } }).webp().toBuffer();
  const intent = await json(await postIntent(jsonReq("POST", "/api/v1/staff/media/upload-intents", as, { purpose: "PRODUCT_PHOTO", mimeType: "image/webp", sizeBytes: bytes.length }), params({})));
  const uploadId = String(intent.body.uploadId);
  const put = await putContent(new NextRequest(`${origin()}/api/v1/staff/media/${uploadId}/content`, { method: "PUT", headers: { origin: origin(), "content-type": "image/webp", "x-test-staff": as }, body: new Uint8Array(bytes) }), params({ uploadId }));
  expect(put.status).toBe(200);
  const fin = await json(await postFinalize(jsonReq("POST", `/api/v1/staff/media/${uploadId}/finalize`, as, { alt: "Bottle, front" }), params({ uploadId })));
  return String(fin.body.storageKey);
}

async function draft(keys: string[], approved: boolean) {
  const category = await db().category.findUniqueOrThrow({ where: { slug: "skincare" } });
  return {
    title: "Photo Serum",
    slug: "photo-serum",
    brand: "Real Brand",
    categoryId: category.id,
    description: "Description reviewed against the packaging.",
    variants: [{ id: null, sku: "PHOTO-SERUM-30", attributes: { size: "30 ml" }, priceRwf: 18000, isActive: true }],
    media: keys.map((storageKey, sortOrder) => ({ storageKey, alt: "Bottle, front", variantId: null, sortOrder })),
    contentReviewed: approved,
    imageRightsConfirmed: approved,
    isSynthetic: false,
  };
}

async function replace(as: string, productId: string, keys: string[], approved: boolean) {
  const current = await db().product.findUniqueOrThrow({ where: { id: productId } });
  const res = await json(await putProduct(jsonReq("PUT", `/api/v1/staff/products/${productId}`, as, { expectedVersion: current.version, draft: await draft(keys, approved) }), params({ productId })));
  expect(res.status).toBe(200);
}

async function addStock(as: string) {
  const preview = await json(
    await postImportPreview(
      jsonReq("POST", "/api/v1/staff/inventory/import-previews", as, {
        rows: [{ sku: "PHOTO-SERUM-30", quantityOnHand: 5, ownership: "OWNED", supplierId: null, agreementReference: null, batchReference: "B-1", expiryDate: "2028-01-31", unitCostRwf: null }],
      }),
      params({}),
    ),
  );
  const previewId = String(preview.body.id);
  const applied = await postImportApply(jsonReq("POST", `/api/v1/staff/inventory/import-previews/${previewId}/apply`, as, { sourceHash: preview.body.sourceHash, reason: "Opening count" }), params({ previewId }));
  expect(applied.status).toBe(200);
}

async function setState(as: string, productId: string, state: "PUBLISHED" | "ARCHIVED") {
  const version = (await db().product.findUniqueOrThrow({ where: { id: productId } })).version;
  return json(await postPublication(jsonReq("POST", `/api/v1/staff/products/${productId}/publication`, as, { expectedVersion: version, state, reason: "Test" }), params({ productId })));
}

const reviewState = async (storageKey: string) => (await db().productMedia.findUniqueOrThrow({ where: { storageKey } })).reviewState;
const syncJobs = () => db().outboxJob.count({ where: { type: "MEDIA_PUBLIC_SYNC" } });

describe("public copies of product photos", () => {
  it("an approved photo is public at once; unapproving or removing it takes the copy away", async () => {
    const as = await staff();
    const key = await uploadPhoto(as);
    expect(await local().isPublic(key)).toBe(false); // finalized, not yet approved

    const created = await json(await postProduct(jsonReq("POST", "/api/v1/staff/products", as, await draft([key], true)), params({})));
    expect(created.status).toBe(201);
    const productId = (created.body.product as { id: string }).id;
    expect(await reviewState(key)).toBe("APPROVED");
    expect(await local().isPublic(key)).toBe(true);
    expect(await syncJobs()).toBe(1);
    // Staff screens keep using the app's guarded route.
    expect((created.body.media as { url: string }[])[0]!.url).toBe(`${origin()}/media/${key}`);

    await replace(as, productId, [key], false); // image rights no longer confirmed
    expect(await reviewState(key)).toBe("PENDING");
    expect(await local().isPublic(key)).toBe(false);

    await replace(as, productId, [key], true);
    expect(await local().isPublic(key)).toBe(true);

    await replace(as, productId, [], true); // photo removed from the product
    expect(await reviewState(key)).toBe("REJECTED");
    expect(await local().isPublic(key)).toBe(false);
    expect(await syncJobs()).toBe(4); // one per change, none for saves that changed nothing

    // The durable jobs agree with what was already applied.
    const run = await runDueJobs({ batchSize: 10, maxRuntimeMs: 10_000 });
    expect(run).toMatchObject({ claimed: 4, completed: 4, retryDue: 0, needsReview: 0 });
    expect(await local().isPublic(key)).toBe(false);
  });

  it("when storage fails after the save, the job applies the change later", async () => {
    const as = await staff();
    const key = await uploadPhoto(as);
    const real = mediaStorage();
    let down = true;
    const flaky: MediaStorage = Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
      publish: async (k: string) => {
        if (down) throw new Error("storage unavailable");
        return real.publish(k);
      },
    });
    setAdaptersForTests({ media: flaky });

    const created = await json(await postProduct(jsonReq("POST", "/api/v1/staff/products", as, await draft([key], true)), params({})));
    expect(created.status).toBe(201); // the save itself succeeds
    expect(await local().isPublic(key)).toBe(false);
    // The save's job, plus a follow-up from the immediate sync that could not finish.
    expect(await runDueJobs({ batchSize: 5, maxRuntimeMs: 5_000 })).toMatchObject({ claimed: 2, retryDue: 2 });

    down = false;
    await db().outboxJob.updateMany({ where: { type: "MEDIA_PUBLIC_SYNC" }, data: { dueAt: new Date(Date.now() - 1000) } });
    expect(await runDueJobs({ batchSize: 5, maxRuntimeMs: 5_000 })).toMatchObject({ claimed: 2, completed: 2 });
    expect(await local().isPublic(key)).toBe(true);
  });

  it("a job whose photo changes state while it runs goes round again and ends on the latest state", async () => {
    const as = await staff();
    const key = await uploadPhoto(as);
    const created = await json(await postProduct(jsonReq("POST", "/api/v1/staff/products", as, await draft([key], true)), params({})));
    expect(created.status).toBe(201);
    expect(await local().isPublic(key)).toBe(true);
    // Let the save's own job finish first (the runtime role cannot delete jobs).
    expect(await runDueJobs({ batchSize: 5, maxRuntimeMs: 5_000 })).toMatchObject({ claimed: 1, completed: 1 });

    // The photo is withdrawn and a job records it; while that job removes the public copy,
    // a concurrent edit approves the photo again.
    const media = await db().productMedia.update({ where: { storageKey: key }, data: { reviewState: "PENDING" } });
    await transaction((tx) => enqueuePublicSync(tx, media.id, key));
    const real = mediaStorage();
    let raced = false;
    setAdaptersForTests({
      media: Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
        unpublish: async (k: string) => {
          await real.unpublish(k);
          if (!raced) {
            raced = true;
            await db().productMedia.update({ where: { storageKey: key }, data: { reviewState: "APPROVED" } });
          }
        },
      }) as MediaStorage,
    });

    expect(await runDueJobs({ batchSize: 5, maxRuntimeMs: 5_000 })).toMatchObject({ claimed: 1, retryDue: 1 });
    expect(await local().isPublic(key)).toBe(false); // acted on the old state...
    await db().outboxJob.updateMany({ where: { type: "MEDIA_PUBLIC_SYNC" }, data: { dueAt: new Date(Date.now() - 1000) } });
    expect(await runDueJobs({ batchSize: 5, maxRuntimeMs: 5_000 })).toMatchObject({ claimed: 1, completed: 1 });
    expect(await local().isPublic(key)).toBe(true); // ...and converged on the new one
  });

  it("publication waits until the photos are public: a storage failure publishes nothing", async () => {
    const as = await staff();
    const key = await uploadPhoto(as);
    const created = await json(await postProduct(jsonReq("POST", "/api/v1/staff/products", as, await draft([key], true)), params({})));
    const productId = (created.body.product as { id: string }).id;
    await addStock(as);

    // The public copy went missing (for example deleted by hand), and storage is down.
    await local().unpublish(key);
    const real = mediaStorage();
    setAdaptersForTests({
      media: Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
        publish: async () => {
          throw new Error("storage unavailable");
        },
      }) as MediaStorage,
    });
    const refused = await setState(as, productId, "PUBLISHED");
    expect(refused.status).toBe(503);
    expect(refused.body.code).toBe("PROVIDER_UNAVAILABLE");
    expect((await db().product.findUniqueOrThrow({ where: { id: productId } })).publishState).toBe("DRAFT");

    setAdaptersForTests({});
    expect((await setState(as, productId, "PUBLISHED")).status).toBe(200);
    expect(await local().isPublic(key)).toBe(true);
  });

  it("a real edit that withdraws the photo while publication copies it leaves the photo private, and nothing publishes", async () => {
    const as = await staff();
    const key = await uploadPhoto(as);
    const created = await json(await postProduct(jsonReq("POST", "/api/v1/staff/products", as, await draft([key], true)), params({})));
    const productId = (created.body.product as { id: string }).id;
    await addStock(as);
    await local().unpublish(key);
    const version = (await db().product.findUniqueOrThrow({ where: { id: productId } })).version;

    // Publication copies the photo; at that moment another staff member saves the product
    // with image rights unticked (the real endpoint: its own transaction, job and sync), and
    // the worker runs in between.
    const real = mediaStorage();
    let raced = false;
    setAdaptersForTests({
      media: Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
        publish: async (k: string) => {
          await real.publish(k);
          if (!raced) {
            raced = true;
            await replace(as, productId, [key], false);
            await runDueJobs({ batchSize: 10, maxRuntimeMs: 5_000 });
          }
        },
      }) as MediaStorage,
    });
    const res = await json(await postPublication(jsonReq("POST", `/api/v1/staff/products/${productId}/publication`, as, { expectedVersion: version, state: "PUBLISHED", reason: "Launch" }), params({ productId })));
    expect(raced).toBe(true);
    expect(await local().isPublic(key)).toBe(false); // the stale copy was taken back at once
    expect(res.status).toBe(409); // the product changed under the publication
    setAdaptersForTests({});
    await runDueJobs({ batchSize: 10, maxRuntimeMs: 5_000 });
    expect(await local().isPublic(key)).toBe(false);
    expect(await db().outboxJob.count({ where: { type: "MEDIA_PUBLIC_SYNC", state: { in: ["READY", "RETRY_DUE", "LEASED"] } } })).toBe(0);
    expect((await db().product.findUniqueOrThrow({ where: { id: productId } })).publishState).toBe("DRAFT");
  });

  it("archiving a product withdraws its photos from the public bucket; publishing it again restores them", async () => {
    const as = await staff();
    const key = await uploadPhoto(as);
    const created = await json(await postProduct(jsonReq("POST", "/api/v1/staff/products", as, await draft([key], true)), params({})));
    const productId = (created.body.product as { id: string }).id;
    await addStock(as);
    expect((await setState(as, productId, "PUBLISHED")).status).toBe(200);
    expect(await local().isPublic(key)).toBe(true);

    expect((await setState(as, productId, "ARCHIVED")).status).toBe(200);
    expect(await local().isPublic(key)).toBe(false);
    expect(await reviewState(key)).toBe("APPROVED"); // the review itself stands

    expect((await setState(as, productId, "PUBLISHED")).status).toBe(200);
    expect(await local().isPublic(key)).toBe(true);
    const run = await runDueJobs({ batchSize: 10, maxRuntimeMs: 5_000 });
    expect(run.retryDue + run.needsReview).toBe(0);
    expect(await local().isPublic(key)).toBe(true);
  });

  it("a photo that belongs to one product cannot be put on another", async () => {
    const as = await staff();
    const key = await uploadPhoto(as);
    expect((await postProduct(jsonReq("POST", "/api/v1/staff/products", as, await draft([key], true)), params({}))).status).toBe(201);
    const other = { ...(await draft([key], false)), slug: "other-serum", variants: [{ id: null, sku: "OTHER-SERUM-30", attributes: { size: "30 ml" }, priceRwf: 9000, isActive: true }] };
    const refused = await json(await postProduct(jsonReq("POST", "/api/v1/staff/products", as, other), params({})));
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain("belongs to another product");
    expect(await reviewState(key)).toBe("APPROVED"); // the first product's photo is untouched
    expect(await local().isPublic(key)).toBe(true);
  });

  it("a replayed upload request gets no new upload URL once that upload is finished", async () => {
    const as = await staff();
    const bytes = await sharp({ create: { width: 800, height: 800, channels: 3, background: { r: 1, g: 2, b: 3 } } }).webp().toBuffer();
    const key = `test-${randomUUID()}`;
    const intentReq = () =>
      new NextRequest(`${origin()}/api/v1/staff/media/upload-intents`, {
        method: "POST",
        headers: { origin: origin(), "content-type": "application/json", "idempotency-key": key, "x-test-staff": as },
        body: JSON.stringify({ purpose: "PRODUCT_PHOTO", mimeType: "image/webp", sizeBytes: bytes.length }),
      });
    const first = await json(await postIntent(intentReq(), params({})));
    const uploadId = String(first.body.uploadId);
    const replay = await json(await postIntent(intentReq(), params({})));
    expect(replay.status).toBe(200); // still open: same upload, a usable URL
    expect(replay.body.uploadId).toBe(uploadId);
    await putContent(new NextRequest(`${origin()}/api/v1/staff/media/${uploadId}/content`, { method: "PUT", headers: { origin: origin(), "content-type": "image/webp", "x-test-staff": as }, body: new Uint8Array(bytes) }), params({ uploadId }));
    await postFinalize(jsonReq("POST", `/api/v1/staff/media/${uploadId}/finalize`, as, { alt: "x" }), params({ uploadId }));
    const late = await json(await postIntent(intentReq(), params({})));
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("ACTION_NOT_ALLOWED");
  });
  it("finalize enforces the declared size on what actually arrived (direct uploads bypass the app)", async () => {
    const as = await staff();
    const bytes = await sharp({ create: { width: 800, height: 800, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer();
    const intent = await json(await postIntent(jsonReq("POST", "/api/v1/staff/media/upload-intents", as, { purpose: "PRODUCT_PHOTO", mimeType: "image/png", sizeBytes: 100 }), params({})));
    const uploadId = String(intent.body.uploadId);
    // As a browser would, straight to the storage target with more bytes than declared.
    await mediaStorage().putStaging(`staging/${uploadId}`, bytes, "image/png");
    const fin = await json(await postFinalize(jsonReq("POST", `/api/v1/staff/media/${uploadId}/finalize`, as, { alt: "x" }), params({ uploadId })));
    expect(fin.body).toMatchObject({ reviewState: "REJECTED", rejectReason: "The uploaded file is larger than declared." });
  });
});

// DR-046: raw uploads (staging/<uploadId>) are deleted once no upload URL can still write
// to them; finished photos are never touched.
describe("raw upload clean-up", () => {
  async function abandonedUpload(as: string): Promise<string> {
    const bytes = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 90, b: 140 } } }).webp().toBuffer();
    const intent = await json(await postIntent(jsonReq("POST", "/api/v1/staff/media/upload-intents", as, { purpose: "PRODUCT_PHOTO", mimeType: "image/webp", sizeBytes: bytes.length }), params({})));
    const uploadId = String(intent.body.uploadId);
    const put = await putContent(new NextRequest(`${origin()}/api/v1/staff/media/${uploadId}/content`, { method: "PUT", headers: { origin: origin(), "content-type": "image/webp", "x-test-staff": as }, body: new Uint8Array(bytes) }), params({ uploadId }));
    expect(put.status).toBe(200);
    return `staging/${uploadId}`;
  }
  const cleared = async (stagingKey: string) => (await db().mediaUpload.findUniqueOrThrow({ where: { stagingKey } })).stagingClearedAt;

  it("removes abandoned and late raw uploads once their upload URLs are spent, never sooner and never a finished photo", async () => {
    const as = await staff();
    const photo = await uploadPhoto(as);
    const finished = (await db().mediaUpload.findUniqueOrThrow({ where: { storageKey: photo } })).stagingKey;
    expect(await local().readStaging(finished)).toBeNull(); // finalize already removed it
    await local().putStaging(finished, Buffer.from("arrived late through a still-valid upload URL"));
    const abandoned = await abandonedUpload(as);

    advanceSeconds(INTENT_TTL_SECONDS + STAGING_CLEAR_AFTER_SECONDS - 60);
    expect(await clearSpentStagingUploads()).toBe(0); // an upload URL could still be in use
    expect(await local().readStaging(abandoned)).not.toBeNull();
    const fresh = await abandonedUpload(as);

    advanceSeconds(120);
    expect(await clearSpentStagingUploads()).toBe(2);
    expect(await local().readStaging(finished)).toBeNull();
    expect(await local().readStaging(abandoned)).toBeNull();
    expect(await cleared(finished)).not.toBeNull();
    expect(await cleared(abandoned)).not.toBeNull();
    expect(await local().readStaging(fresh)).not.toBeNull(); // its own URLs are still valid
    expect(await cleared(fresh)).toBeNull();
    expect(await local().readPrivate(photo)).not.toBeNull(); // the finished photo stays
    expect(await clearSpentStagingUploads()).toBe(0);
  });

  it("marks nothing while storage fails, and the next run finishes", async () => {
    const as = await staff();
    const abandoned = await abandonedUpload(as);
    advanceSeconds(INTENT_TTL_SECONDS + STAGING_CLEAR_AFTER_SECONDS + 60);
    const real = mediaStorage();
    let down = true;
    const flaky: MediaStorage = Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
      deleteStagingMany: async (keys: string[]) => {
        if (down) throw new Error("storage unavailable");
        return real.deleteStagingMany(keys);
      },
    });
    setAdaptersForTests({ media: flaky });

    await runStorageHousekeepingSafely(); // logs, never throws
    expect(await cleared(abandoned)).toBeNull();
    expect(await local().readStaging(abandoned)).not.toBeNull();
    down = false;
    await runStorageHousekeepingSafely();
    expect(await cleared(abandoned)).not.toBeNull();
    expect(await local().readStaging(abandoned)).toBeNull();
  });

  it("runs from the scheduled job runner", async () => {
    const as = await staff();
    const abandoned = await abandonedUpload(as);
    advanceSeconds(INTENT_TTL_SECONDS + STAGING_CLEAR_AFTER_SECONDS + 60);
    const res = await postJobsRun(
      new NextRequest(`${origin()}/api/v1/internal/jobs/run`, { method: "POST", headers: { authorization: `Bearer ${process.env.WORKER_SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ batchSize: 5, maxRuntimeSeconds: 5 }) }),
      params({}),
    );
    expect(res.status).toBe(200);
    expect(await cleared(abandoned)).not.toBeNull();
    expect(await local().readStaging(abandoned)).toBeNull();
  });
});
