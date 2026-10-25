import "server-only";
import { db } from "@/server/db";
import { hashToken } from "@/server/crypto";
import { now } from "@/modules/shared/clock";
import { DomainError } from "@/modules/shared/errors";

// Fixed-window counters in PostgreSQL: correct across serverless instances without
// adding Redis (handoff Architecture). Identifiers are stored only as keyed hashes.

export const LIMITS = {
  session: { limit: 30, windowSeconds: 600 },
  cart: { limit: 120, windowSeconds: 600 },
  quote: { limit: 30, windowSeconds: 600 },
  paymentSession: { limit: 10, windowSeconds: 600 },
  paymentAddress: { limit: 40, windowSeconds: 600 },
  orderLinkExchange: { limit: 10, windowSeconds: 600 },
  statusRead: { limit: 600, windowSeconds: 600 },
  callbackUnverified: { limit: 20, windowSeconds: 600 },
  orderAction: { limit: 20, windowSeconds: 600 }, // cancellation requests, private-link creation
  siteAccess: { limit: 8, windowSeconds: 600 }, // access-code attempts per address (DR-044)
  launchList: { limit: 10, windowSeconds: 600 }, // launch-list sign-ups per address (DR-045)
} as const;

export async function rateLimit(bucket: keyof typeof LIMITS, identifier: string): Promise<void> {
  const { limit, windowSeconds } = LIMITS[bucket];
  const t = now();
  const windowStart = new Date(Math.floor(t.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const key = `${bucket}:${hashToken(identifier).slice(0, 32)}`;
  const rows = await db().$queryRaw<{ count: number }[]>`
    INSERT INTO commerce.rate_limit_buckets (key, window_start, count)
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN commerce.rate_limit_buckets.window_start = EXCLUDED.window_start
                   THEN commerce.rate_limit_buckets.count + 1 ELSE 1 END,
      window_start = EXCLUDED.window_start
    RETURNING count`;
  if ((rows[0]?.count ?? 0) > limit) {
    const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + windowSeconds * 1000 - t.getTime()) / 1000));
    throw new DomainError("RATE_LIMITED", "Too many attempts. Please wait a moment and try again.", { retryAfterSeconds: retryAfter });
  }
}
