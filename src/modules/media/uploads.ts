import "server-only";
import { randomUUID } from "node:crypto";
import sharp, { type OutputInfo } from "sharp";
import { db, transaction } from "@/server/db";
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from "@/modules/idempotency/idempotency";
import { mediaStorage } from "@/adapters/registry";
import { addSeconds, now } from "@/modules/shared/clock";
import { DomainError, notFound } from "@/modules/shared/errors";
import { staffMediaUrl } from "@/modules/catalog/media";
import { audit } from "@/modules/audit/audit";
import { can } from "@/modules/staff/capabilities";
import type { StaffIdentity } from "@/modules/staff/identity";

// Staff media uploads (contract createMediaUploadIntent / finalizeMedia; Security-and-
// Operations "Restrict upload MIME type, byte size, dimensions and ownership. Verify/
// decode uploaded image content, strip unnecessary metadata, generate safe derivatives
// and use immutable storage keys"). SVG is never accepted. The uploaded original is
// discarded; only a re-encoded WebP derivative (no metadata) is kept.

export const MAX_UPLOAD_BYTES = 10_000_000;
export const INTENT_TTL_SECONDS = 15 * 60;
const MIN_EDGE = 300;
const MAX_EDGE = 10_000;
const MAX_PIXELS = 40_000_000;
const DERIVATIVE_EDGE = 1600;

export type MediaPurpose = "PRODUCT_PHOTO" | "PRIVATE_EVIDENCE";
export type UploadMime = "image/jpeg" | "image/png" | "image/webp";

const FORMAT_FOR: Record<UploadMime, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

// Contract: media uploads are ADMIN/OPERATIONS (catalog.write) for both purposes, and the
// capability is re-checked on every step, so a demotion takes effect mid-upload (RF-24).
const assertCanUpload = (staff: StaffIdentity) => {
  if (!can(staff.role, "catalog.write")) throw new DomainError("FORBIDDEN", "Your role does not allow uploads.");
};

export async function createUploadIntent(
  staff: StaffIdentity,
  input: { purpose: MediaPurpose; mimeType: UploadMime; sizeBytes: number },
  key: string,
  requestId: string | null,
) {
  assertCanUpload(staff);
  if (input.sizeBytes < 1 || input.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new DomainError("VALIDATION_ERROR", "Photos must be 10 MB or smaller.", { fieldErrors: [{ field: "sizeBytes", message: "Too large." }] });
  }
  const id = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:media-intent`, key, requestHash: requestHash("createUploadIntent", input) });
    if (claim.kind === "REPLAY") return claim.resourceId;
    const uploadId = randomUUID();
    await tx.mediaUpload.create({
      data: { id: uploadId, purpose: input.purpose, declaredMimeType: input.mimeType, declaredBytes: input.sizeBytes, stagingKey: `staging/${uploadId}`, createdByStaffId: staff.staffId, expiresAt: addSeconds(now(), INTENT_TTL_SECONDS) },
    });
    await audit(tx, { actor: { type: "STAFF", id: staff.staffId }, entityType: "media_upload", entityId: uploadId, action: "MEDIA_UPLOAD_INTENT", after: { purpose: input.purpose, mimeType: input.mimeType, sizeBytes: input.sizeBytes }, requestId });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "media_upload", resourceId: uploadId, responseStatus: 200 });
    return uploadId;
  });
  const upload = await db().mediaUpload.findUniqueOrThrow({ where: { id } });
  // A replayed request gets a fresh upload URL only while its upload is still open: hosted
  // storage URLs stay usable for 2 hours, so none is handed out for a finished or expired one.
  if (upload.state !== "INTENT" || upload.expiresAt <= now()) {
    throw new DomainError("ACTION_NOT_ALLOWED", "This upload is already finished or has expired. Start a new upload.");
  }
  // Hosted storage returns a signed URL bound to exactly this staging key (DR-041).
  return { uploadId: upload.id, uploadUrl: await mediaStorage().uploadTarget(upload.stagingKey), expiresAt: upload.expiresAt.toISOString() };
}

async function ownIntent(staff: StaffIdentity, uploadId: string) {
  assertCanUpload(staff);
  const upload = await db().mediaUpload.findUnique({ where: { id: uploadId } });
  // Someone else's upload is indistinguishable from a missing one.
  if (!upload || upload.createdByStaffId !== staff.staffId) throw notFound();
  return upload;
}

/** Receives the raw bytes for an intent (local storage; hosted storage takes them at a signed URL). */
export async function receiveUploadContent(staff: StaffIdentity, uploadId: string, contentType: string | null, bytes: Buffer): Promise<void> {
  const upload = await ownIntent(staff, uploadId);
  if (upload.state !== "INTENT") throw new DomainError("ACTION_NOT_ALLOWED", "This upload is already finished.");
  if (upload.expiresAt <= now()) throw new DomainError("ACTION_NOT_ALLOWED", "This upload expired. Start again.");
  if ((contentType ?? "").split(";")[0]!.trim().toLowerCase() !== upload.declaredMimeType) {
    throw new DomainError("VALIDATION_ERROR", "The file type does not match the upload.");
  }
  if (bytes.length === 0 || bytes.length > upload.declaredBytes || bytes.length > MAX_UPLOAD_BYTES) {
    throw new DomainError("VALIDATION_ERROR", "The file size does not match the upload.");
  }
  await mediaStorage().putStaging(upload.stagingKey, bytes, upload.declaredMimeType);
}

export type FinalizeResult = {
  storageKey: string;
  reviewState: "PENDING_REVIEW" | "REJECTED";
  // Additions (CC-14)
  url: string | null;
  width: number | null;
  height: number | null;
  rejectReason: string | null;
};

const rejected = (reason: string): FinalizeResult => ({ storageKey: "", reviewState: "REJECTED", url: null, width: null, height: null, rejectReason: reason });

function finalView(upload: { state: string; storageKey: string | null; purpose: string; width: number | null; height: number | null; rejectReason: string | null }): FinalizeResult {
  if (upload.state === "REJECTED" || !upload.storageKey) return rejected(upload.rejectReason ?? "This file was rejected.");
  return {
    storageKey: upload.storageKey,
    reviewState: "PENDING_REVIEW",
    url: upload.purpose === "PRODUCT_PHOTO" ? staffMediaUrl(upload.storageKey) : null,
    width: upload.width,
    height: upload.height,
    rejectReason: null,
  };
}

/**
 * Decodes the uploaded bytes, checks the real format and dimensions, and stores a
 * re-encoded WebP derivative under a new immutable key. Calling it again returns the
 * same result. A product photo still needs the editor's content/rights review before it
 * is shown publicly.
 */
export async function finalizeUpload(staff: StaffIdentity, uploadId: string, alt: string, requestId: string | null): Promise<FinalizeResult> {
  const upload = await ownIntent(staff, uploadId);
  if (upload.state !== "INTENT") return finalView(upload);
  const storage = mediaStorage();
  const storageKey = `${upload.purpose === "PRODUCT_PHOTO" ? "products" : "evidence"}/${upload.id}.webp`;
  if (upload.storageKey && upload.storageKey !== storageKey)
    throw new DomainError("ACTION_NOT_ALLOWED", "This upload already has a different storage key.");
  const finishStored = async (stored: Buffer): Promise<FinalizeResult> => {
    // A reserved key can outlive both intent expiry and raw-staging cleanup.
    // Only a server-created, valid WebP derivative can complete that record.
    let width: number; let height: number;
    try {
      const meta = await sharp(stored, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
      if (meta.format !== "webp" || !meta.width || !meta.height || meta.width > DERIVATIVE_EDGE || meta.height > DERIVATIVE_EDGE)
        throw new Error("Invalid stored derivative");
      width = meta.width; height = meta.height;
    } catch {
      throw new DomainError("ACTION_NOT_ALLOWED", "The stored photo needs staff investigation.");
    }
    const cleanAlt = alt.trim().slice(0, 240);
    const updated = await db().mediaUpload.updateMany({
      where: { id: upload.id, state: "INTENT", storageKey },
      data: { state: "FINALIZED", width, height, alt: cleanAlt || null, finalizedAt: now() },
    });
    await storage.deleteStaging(upload.stagingKey);
    if (updated.count !== 1) return finalView(await db().mediaUpload.findUniqueOrThrow({ where: { id: upload.id } }));
    await db().$transaction((tx) =>
      audit(tx, { actor: { type: "STAFF", id: staff.staffId }, entityType: "media_upload", entityId: upload.id, action: "MEDIA_FINALIZED", after: { storageKey, width, height }, requestId }),
    );
    return finalView(await db().mediaUpload.findUniqueOrThrow({ where: { id: upload.id } }));
  };
  if (upload.storageKey) {
    const stored = await storage.readPrivate(storageKey);
    if (stored) return finishStored(stored);
  }
  if (upload.expiresAt <= now()) throw new DomainError("ACTION_NOT_ALLOWED", "This upload expired without a stored photo. Start again after checking the intent.");
  const bytes = await storage.readStaging(upload.stagingKey);
  if (!bytes) throw new DomainError("VALIDATION_ERROR", "Upload the file before finishing.");

  const reject = async (reason: string) => {
    // A concurrent valid finalize may already have reserved the derivative key.
    // Never reject its intent after that reservation, or its private object could
    // become unreachable from the upload record.
    const changed = await db().mediaUpload.updateMany({ where: { id: upload.id, state: "INTENT", storageKey: null }, data: { state: "REJECTED", rejectReason: reason, finalizedAt: now() } });
    if (changed.count !== 1) {
      const current = await db().mediaUpload.findUniqueOrThrow({ where: { id: upload.id } });
      if (current.state !== "INTENT") return finalView(current);
      throw new DomainError("ACTION_NOT_ALLOWED", "This upload is already being finalized. Retry its upload ID after checking the outcome.");
    }
    await storage.deleteStaging(upload.stagingKey);
    return rejected(reason);
  };

  // With hosted storage the browser uploads straight to a signed URL, so the declared size
  // is enforced here, on what actually arrived (the bucket also caps uploads at 10 MB).
  if (bytes.length > upload.declaredBytes || bytes.length > MAX_UPLOAD_BYTES) return reject("The uploaded file is larger than declared.");

  let derivative: { data: Buffer; info: OutputInfo };
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" });
    const meta = await image.metadata();
    if (meta.format !== FORMAT_FOR[upload.declaredMimeType as UploadMime]) return reject("The file is not the image type it claims to be.");
    const width = meta.autoOrient?.width ?? meta.width ?? 0;
    const height = meta.autoOrient?.height ?? meta.height ?? 0;
    if (width < MIN_EDGE || height < MIN_EDGE) return reject(`Photos must be at least ${MIN_EDGE} × ${MIN_EDGE} pixels.`);
    if (width > MAX_EDGE || height > MAX_EDGE) return reject("This photo is too large in pixels.");
    // rotate() applies EXIF orientation; metadata (EXIF/GPS/ICC comments) is not copied.
    derivative = await image
      .rotate()
      .resize({ width: DERIVATIVE_EDGE, height: DERIVATIVE_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    return reject("This file could not be read as an image.");
  }

  // Bind one immutable derivative key to one upload ID. Reserve it in the DB
  // before writing bytes: a crash after storage succeeds can be recovered via
  // the same intent, and two concurrent finalizers cannot mint orphan keys.
  const reservation = await db().mediaUpload.updateMany({
    where: { id: upload.id, state: "INTENT", storageKey: null }, data: { storageKey },
  });
  if (reservation.count !== 1) {
    const current = await db().mediaUpload.findUniqueOrThrow({ where: { id: upload.id } });
    if (current.state !== "INTENT") return finalView(current);
    if (current.storageKey !== storageKey) throw new DomainError("ACTION_NOT_ALLOWED", "This upload already has a different storage key.");
    const alreadyStored = await storage.readPrivate(storageKey);
    if (alreadyStored) return finishStored(alreadyStored);
  }
  // Both adapters refuse overwrites. If another request won with different
  // staged bytes, the first validated immutable derivative remains canonical.
  try {
    await storage.putPrivate(storageKey, derivative.data, "image/webp");
  } catch (error) {
    const existing = await storage.readPrivate(storageKey);
    if (!existing) throw error;
    return finishStored(existing);
  }
  return finishStored(derivative.data);
}

/**
 * Product photos through the app's /media route: the storefront's images in local
 * development, and staff previews with any storage. Approved photos are public; a
 * finalized photo awaiting review is visible only to staff; a rejected one to nobody.
 */
export async function readProductMedia(key: string): Promise<{ bytes: Buffer; approved: boolean } | null> {
  if (!/^products\/[0-9a-f-]{36}\.webp$/.test(key)) return null;
  const storage = mediaStorage();
  const record = await db().productMedia.findUnique({ where: { storageKey: key } });
  if (record?.reviewState === "REJECTED") return null;
  if (!record) {
    const upload = await db().mediaUpload.findUnique({ where: { storageKey: key } });
    if (upload?.state !== "FINALIZED") return null;
  }
  const bytes = await storage.readPrivate(key);
  return bytes ? { bytes, approved: record?.reviewState === "APPROVED" } : null;
}
