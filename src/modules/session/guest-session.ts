import "server-only";
import { db, transaction } from "@/server/db";
import { hashToken, newOpaqueToken } from "@/server/crypto";
import { addSeconds, now } from "@/modules/shared/clock";
import { DomainError } from "@/modules/shared/errors";

// Opaque, server-issued guest session (handoff Security-and-Operations). The cookie
// holds a random bearer token; the database stores only its keyed hash. It
// authorizes its own cart, checkout and resulting order and nothing else.

export const GUEST_COOKIE = "bb_guest";
export const GUEST_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days (Decisions: guest cart lifetime)

export type GuestSession = { id: string; expiresAt: Date };

export async function resolveGuestSession(rawToken: string | undefined | null): Promise<GuestSession | null> {
  if (!rawToken || rawToken.length < 32 || rawToken.length > 128) return null;
  const session = await db().guestSession.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!session || session.expiresAt <= now()) return null;
  return { id: session.id, expiresAt: session.expiresAt };
}

export async function requireGuestSession(rawToken: string | undefined | null): Promise<GuestSession> {
  const session = await resolveGuestSession(rawToken);
  if (!session) throw new DomainError("UNAUTHORIZED", "Your session has expired. Refresh the page to continue.");
  return session;
}

/**
 * POST /session: reuse a valid session (never rotating an active cart identity) or
 * create a new one. Ensures the session has an active cart so GET /cart is read-only.
 */
export async function createOrReuseGuestSession(
  rawToken: string | undefined | null,
): Promise<{ session: GuestSession; token: string | null }> {
  const existing = await resolveGuestSession(rawToken);
  const at = now();
  if (existing) {
    await transaction(async (tx) => {
      await tx.guestSession.update({ where: { id: existing.id }, data: { lastSeenAt: at } });
      await ensureActiveCart(tx, existing.id, existing.expiresAt);
    });
    return { session: existing, token: null };
  }
  const token = newOpaqueToken();
  const expiresAt = addSeconds(at, GUEST_SESSION_TTL_SECONDS);
  const session = await transaction(async (tx) => {
    const created = await tx.guestSession.create({
      data: { tokenHash: hashToken(token), expiresAt, createdAt: at, lastSeenAt: at },
    });
    await ensureActiveCart(tx, created.id, expiresAt);
    return created;
  });
  return { session: { id: session.id, expiresAt: session.expiresAt }, token };
}

async function ensureActiveCart(
  tx: Parameters<Parameters<typeof transaction>[0]>[0],
  guestSessionId: string,
  expiresAt: Date,
) {
  // Serialize per session so two concurrent bootstraps cannot create two carts.
  await tx.$queryRaw`SELECT id FROM commerce.guest_sessions WHERE id = ${guestSessionId}::uuid FOR UPDATE`;
  const active = await tx.cart.findFirst({ where: { guestSessionId, state: "ACTIVE" } });
  if (!active) await tx.cart.create({ data: { guestSessionId, expiresAt } });
}
