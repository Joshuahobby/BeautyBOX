import "server-only";
import { transaction, type Tx } from "@/server/db";
import { hashToken, newOpaqueToken } from "@/server/crypto";
import { serverEnv } from "@/server/env";
import { addSeconds, now } from "@/modules/shared/clock";
import { DomainError, notFound } from "@/modules/shared/errors";
import { orderAccess, type OrderViewer } from "./access";

// Private order links (Security-and-Operations "Private order access"; decisions: 7 days,
// one-time exchange into an order-scoped session; T15).
// - 32 random bytes (the handoff's minimum) in the URL FRAGMENT: never in a request path,
//   server log or referrer. The page posts it once and removes the fragment. Links shown in the
//   browser use /order-access#token=<token>; links sent by SMS use the short page /o#<token>
//   (17 characters shorter) so a message fits one SMS part (DR-049).
// - Only a keyed hash is stored. Exchange consumes the token atomically and creates an
//   order-scoped HttpOnly session.
// - Raw tokens are generated at the moment the message carrying them is sent (or shown
//   once to the guest session that placed the order) and are never stored.

export const LINK_TTL_SECONDS = 7 * 24 * 60 * 60;
export const ORDER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function privateLinkUrl(token: string): string {
  return `${serverEnv().APP_ORIGIN.replace(/\/$/, "")}/order-access#token=${token}`;
}

/** The short form for SMS (DR-049): the page at /o reads the bare token from the fragment. */
export function smsPrivateLinkUrl(token: string): string {
  return `${serverEnv().APP_ORIGIN.replace(/\/$/, "")}/o#${token}`;
}

/** Issues a new single-use link and returns its raw token (shown or sent once). */
export async function issuePrivateLink(tx: Tx, orderId: string, input: { reason: string; issuedByStaffId?: string | null }): Promise<{ token: string; expiresAt: Date }> {
  const token = newOpaqueToken(32);
  const expiresAt = addSeconds(now(), LINK_TTL_SECONDS);
  await tx.privateOrderLink.create({
    data: { orderId, tokenHash: hashToken(token), expiresAt, issuedByStaffId: input.issuedByStaffId ?? null, reason: input.reason },
  });
  return { token, expiresAt };
}

/**
 * Support reissue: every outstanding link and order-scoped session for the order stops
 * working, and so does the browser session that placed it (it may be on a lost or shared
 * device). Only links and sessions issued afterwards grant access (RF-22).
 */
export async function revokeOrderAccess(tx: Tx, orderId: string): Promise<{ links: number; sessions: number; guestSession: boolean }> {
  const at = now();
  const links = await tx.privateOrderLink.updateMany({ where: { orderId, consumedAt: null, revokedAt: null }, data: { revokedAt: at } });
  const sessions = await tx.orderSession.updateMany({ where: { orderId, revokedAt: null }, data: { revokedAt: at } });
  const guest = await tx.order.updateMany({ where: { id: orderId, guestAccessRevokedAt: null }, data: { guestAccessRevokedAt: at } });
  return { links: links.count, sessions: sessions.count, guestSession: guest.count > 0 };
}

export type ExchangeResult =
  | { kind: "OK"; orderId: string; session: { token: string; expiresAt: Date } | null; expiresAt: Date }
  | { kind: "EXPIRED" }
  | { kind: "INVALID" };

/**
 * Atomic one-use exchange. Unknown, revoked and already-used tokens get the same generic
 * INVALID answer; only the holder of a genuine expired token learns that it expired.
 * Re-opening a used link in a browser that already has access to that order simply
 * continues to the order (no new session is created).
 */
export async function exchangePrivateLink(token: string, viewer: OrderViewer): Promise<ExchangeResult> {
  if (token.length < 40 || token.length > 200) return { kind: "INVALID" };
  const tokenHash = hashToken(token);
  return transaction(async (tx) => {
    const at = now();
    const rows = await tx.$queryRaw<{ id: string; order_id: string; expires_at: Date; consumed_at: Date | null; revoked_at: Date | null }[]>`
      SELECT id, order_id, expires_at, consumed_at, revoked_at FROM commerce.private_order_links
       WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const link = rows[0];
    if (!link || link.revoked_at) return { kind: "INVALID" };
    if (link.consumed_at) {
      const existing = await existingAccess(tx, link.order_id, viewer);
      return existing ? { kind: "OK", orderId: link.order_id, session: null, expiresAt: existing } : { kind: "INVALID" };
    }
    if (link.expires_at <= at) return { kind: "EXPIRED" };
    await tx.privateOrderLink.update({ where: { id: link.id }, data: { consumedAt: at } });
    const sessionToken = newOpaqueToken(32);
    const expiresAt = addSeconds(at, ORDER_SESSION_TTL_SECONDS);
    await tx.orderSession.create({ data: { orderId: link.order_id, sessionHash: hashToken(sessionToken), expiresAt } });
    return { kind: "OK", orderId: link.order_id, session: { token: sessionToken, expiresAt }, expiresAt };
  });
}

async function existingAccess(tx: Tx, orderId: string, viewer: OrderViewer): Promise<Date | null> {
  return (await orderAccess(orderId, viewer, tx))?.expiresAt ?? null;
}

/** Verified money exists for the order (paid, or collected after a cancellation/review). */
export async function hasVerifiedCollection(tx: Tx, order: { id: string; paidAt: Date | null }): Promise<boolean> {
  return order.paidAt !== null || (await tx.paymentReceipt.count({ where: { orderId: order.id } })) > 0;
}

/**
 * The guest session that placed a paid order may ask for a private link to open the
 * order on another device (contract addition CC-08). Rate limited by the route.
 */
export async function issueLinkForOwner(viewer: OrderViewer, orderId: string): Promise<{ url: string; expiresAt: string }> {
  const guest = viewer.guestSession;
  return transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    // A support reissue cuts off the original browser session too (RF-22).
    if (!order || !guest || order.guestSessionId !== guest.id || order.guestAccessRevokedAt !== null) throw notFound();
    if (!(await hasVerifiedCollection(tx, order))) throw new DomainError("ACTION_NOT_ALLOWED", "A private link is available once the payment is confirmed.");
    const { token, expiresAt } = await issuePrivateLink(tx, orderId, { reason: "Requested by the guest session that placed the order" });
    return { url: privateLinkUrl(token), expiresAt: expiresAt.toISOString() };
  });
}

