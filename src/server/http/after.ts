import "server-only";
import { after } from "next/server";

/**
 * Best-effort work after the response (a nudge for the durable job worker). Outside a
 * request scope (tests, scripts) `after` throws; the work is then simply skipped, because
 * every job it would run is also picked up by the scheduled worker. Correctness never
 * depends on this running.
 */
export function afterResponse(task: () => Promise<unknown>): void {
  try {
    after(() => task().then(() => undefined));
  } catch {
    // No request scope: the scheduled worker handles it.
  }
}
