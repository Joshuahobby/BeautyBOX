import "server-only";
import { db } from "@/server/db";
import { mediaStorage } from "@/adapters/registry";
import { SIGNED_UPLOAD_URL_SECONDS } from "@/adapters/storage/types";
import { now } from "@/modules/shared/clock";

// Raw photo uploads (staging/<uploadId>) are only an input to finalize, which keeps a
// re-encoded copy and deletes the raw file. What finalize cannot delete is a raw file that
// arrives later through a still-valid upload URL, or one whose upload was never finished.
// This removes them once no upload URL can still write to them (DR-046).

/** An intent hands out upload URLs only before it expires, so this long after its expiry its staging key is spent. A margin covers clock differences. */
export const STAGING_CLEAR_AFTER_SECONDS = SIGNED_UPLOAD_URL_SECONDS + 10 * 60;

/** One storage call per run; the next run continues with the rest. */
export const STAGING_CLEAR_BATCH = 100;

export async function clearSpentStagingUploads(): Promise<number> {
  const cutoff = new Date(now().getTime() - STAGING_CLEAR_AFTER_SECONDS * 1000);
  const due = await db().mediaUpload.findMany({
    where: { stagingClearedAt: null, expiresAt: { lt: cutoff } },
    select: { id: true, stagingKey: true },
    orderBy: { expiresAt: "asc" },
    take: STAGING_CLEAR_BATCH,
  });
  if (due.length === 0) return 0;
  // Marked only after storage confirms, so a failed call is simply retried next run.
  await mediaStorage().deleteStagingMany(due.map((u) => u.stagingKey));
  const { count } = await db().mediaUpload.updateMany({
    where: { id: { in: due.map((u) => u.id) }, stagingClearedAt: null },
    data: { stagingClearedAt: now() },
  });
  return count;
}
