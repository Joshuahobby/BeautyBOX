import "server-only";
import { randomUUID } from "node:crypto";
import { mediaStorage } from "@/adapters/registry";
import { PRODUCT_PHOTO_KEY } from "@/adapters/storage/types";
import { backoffSeconds, enqueueJob, type ClaimedJob, type JobOutcome } from "@/modules/jobs/outbox";
import { db, transaction, type Tx } from "@/server/db";
import { logEvent } from "@/server/log";

// Keeps the public product-photo bucket in step with each photo's state (DR-041): a photo
// has a public copy exactly while it is APPROVED and its product is not ARCHIVED; pending,
// rejected, removed and archived photos have none. Every change of that state enqueues a
// MEDIA_PUBLIC_SYNC job in the same transaction, and the change is also applied right after
// the commit so the storefront updates at once; the job is the durable backstop. Each run
// reads the current state, acts, and reads it again: if the state moved meanwhile it runs
// again, so concurrent edits always converge on the latest state.

async function wantsPublic(storageKey: string): Promise<boolean> {
  const row = await db().productMedia.findUnique({ where: { storageKey }, select: { reviewState: true, product: { select: { publishState: true } } } });
  return row?.reviewState === "APPROVED" && row.product.publishState !== "ARCHIVED";
}

/** Applies the current review state to the public bucket. False if the state changed meanwhile. */
export async function reconcilePublicCopy(storageKey: string): Promise<boolean> {
  if (!PRODUCT_PHOTO_KEY.test(storageKey)) throw new Error("Invalid product photo key");
  const wanted = await wantsPublic(storageKey);
  if (wanted) await mediaStorage().publish(storageKey);
  else await mediaStorage().unpublish(storageKey);
  return (await wantsPublic(storageKey)) === wanted;
}

/** Records, in the caller's transaction, that a photo's public copy must be brought up to date. */
export async function enqueuePublicSync(tx: Tx, mediaId: string, storageKey: string): Promise<void> {
  // One job per change: a job already finished or running never hides a newer change.
  await enqueueJob(tx, { type: "MEDIA_PUBLIC_SYNC", uniqueIntentKey: `media-public:${storageKey}:${randomUUID()}`, entityId: mediaId, payload: { storageKey } });
}

export async function handleMediaPublicSync(job: ClaimedJob): Promise<JobOutcome> {
  const storageKey = (job.payload as { storageKey?: unknown } | null)?.storageKey;
  if (typeof storageKey !== "string" || !PRODUCT_PHOTO_KEY.test(storageKey)) return { kind: "NEEDS_REVIEW", errorCode: "BAD_PAYLOAD" };
  try {
    return (await reconcilePublicCopy(storageKey)) ? { kind: "DONE" } : { kind: "RETRY", afterSeconds: 1, errorCode: "STATE_CHANGED" };
  } catch {
    return { kind: "RETRY", afterSeconds: backoffSeconds(job.attempts, 10, 600), errorCode: "STORAGE_UNAVAILABLE" };
  }
}

/**
 * Applies the current state and confirms it held, a few times if edits race. Every caller
 * that acts outside the durable job uses this, so an action based on a state that changed
 * meanwhile is always noticed by whoever took it.
 */
async function reconcileUntilSettled(storageKey: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) if (await reconcilePublicCopy(storageKey)) return true;
  return false;
}

/** A fresh job, for when an immediate sync could not confirm the result (the original job may already have run). */
async function enqueueFollowUp(storageKey: string): Promise<void> {
  const media = await db().productMedia.findUnique({ where: { storageKey }, select: { id: true } });
  if (media) await transaction((tx) => enqueuePublicSync(tx, media.id, storageKey));
}

/** Best effort right after a commit, so an approved photo is public before the response. */
export async function syncPublicCopiesNow(storageKeys: string[]): Promise<void> {
  for (const key of storageKeys) {
    const settled = await reconcileUntilSettled(key).catch(() => false);
    if (!settled) {
      // Storage failed or edits kept racing: a durable job finishes it; the storefront shows
      // the photo once it has.
      logEvent("warn", "media_public_sync_deferred", { count: 1 });
      await enqueueFollowUp(key);
    }
  }
}

/**
 * Before a product is published: every approved photo must be publicly readable. Throws if
 * storage fails. A photo un-approved by a concurrent edit while this runs is caught by the
 * settle check and left (or made) private.
 */
export async function ensurePublicCopies(productId: string): Promise<void> {
  const approved = await db().productMedia.findMany({ where: { productId, reviewState: "APPROVED" }, select: { storageKey: true } });
  for (const m of approved) {
    // A storage call can apply and still fail (a timeout after the copy landed), so any
    // failure leaves a fresh job to confirm the photo's state.
    const settled = await reconcileUntilSettled(m.storageKey).catch(async (error: unknown) => {
      await enqueueFollowUp(m.storageKey);
      throw error;
    });
    if (!settled) {
      await enqueueFollowUp(m.storageKey);
      throw new Error("media_public_state_unsettled");
    }
  }
}
