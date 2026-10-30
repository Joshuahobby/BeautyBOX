import "server-only";
import { db } from "@/server/db";
import { LIMITS } from "@/server/http/rate-limit";
import { logEvent } from "@/server/log";
import { now } from "@/modules/shared/clock";
import { LAUNCH_RETENTION_DAYS, purgeLaunchList } from "@/modules/launch/launch-list";
import { clearSpentStagingUploads } from "@/modules/media/staging-cleanup";

// Clean-up behind promises made to visitors (DR-045): launch-list sign-ups go at the
// latest 12 months after the latest sign-up, and the keyed-hash rate-limit counters (which
// hold a scrambled network address) go soon after their window ends. Run from the scheduled
// job runner, so it does not depend on an operator remembering it.

const LONGEST_WINDOW_SECONDS = Math.max(...Object.values(LIMITS).map((l) => l.windowSeconds));

export type HousekeepingResult = { launchSignupsDeleted: number; rateLimitBucketsDeleted: number };

export async function runHousekeeping(): Promise<HousekeepingResult> {
  const launchSignupsDeleted = await purgeLaunchList(LAUNCH_RETENTION_DAYS);
  // A counter whose window has ended is only ever reset by the next request, so it can go.
  const cutoff = new Date(now().getTime() - LONGEST_WINDOW_SECONDS * 1000);
  const rateLimitBucketsDeleted = await db().$executeRaw`DELETE FROM commerce.rate_limit_buckets WHERE window_start < ${cutoff}`;
  return { launchSignupsDeleted, rateLimitBucketsDeleted };
}

/**
 * Called first by every job-runner run (Supabase Cron, once a minute), before any job, so a slow
 * or failing job cannot hold it up. Both deletes are indexed and usually remove nothing.
 */
export async function runHousekeepingSafely(): Promise<void> {
  try {
    const result = await runHousekeeping();
    if (result.launchSignupsDeleted > 0 || result.rateLimitBucketsDeleted > 0) logEvent("info", "housekeeping_done", result);
  } catch (error) {
    // Never fails the job run; the next run (a minute later) tries again.
    logEvent("warn", "housekeeping_failed", { error: error instanceof Error ? error.name : "unknown" });
  }
}

/**
 * Clean-up that calls the storage service: raw photo uploads no upload URL can still reach
 * (DR-046). The job runner calls it after the jobs, and only with time to spare, so a slow
 * storage service never delays payment work.
 */
export async function runStorageHousekeepingSafely(): Promise<void> {
  try {
    const stagingUploadsCleared = await clearSpentStagingUploads();
    if (stagingUploadsCleared > 0) logEvent("info", "storage_housekeeping_done", { stagingUploadsCleared });
  } catch (error) {
    // Never fails the job run; nothing was marked, so the next run tries again.
    logEvent("warn", "storage_housekeeping_failed", { error: error instanceof Error ? error.name : "unknown" });
  }
}
