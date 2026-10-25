import "server-only";
import type { Tx } from "@/server/db";
import { db } from "@/server/db";
import { hashToken } from "@/server/crypto";
import { now } from "@/modules/shared/clock";
import type { GuestSession } from "@/modules/session/guest-session";

// Private order access (handoff Security-and-Operations "Private order access"): the
// original guest session (until a support reissue cuts it off), or an order-scoped
// session obtained by exchanging a private link. An order reference or phone number
// never grants access, and "not yours" is indistinguishable from "does not exist".
//
// One order-scoped cookie per order (bb_order_<id>), so opening a second order's link
// never overwrites access to the first (RF-25).

export const ORDER_COOKIE_PREFIX = "bb_order_";
const MAX_ORDER_SESSIONS = 20;

export const orderCookieName = (orderId: string) => `${ORDER_COOKIE_PREFIX}${orderId.replace(/-/g, "")}`;

export type OrderViewer = { guestSession: GuestSession | null; orderSessionTokens: string[] };

/** Order-session tokens a browser presents (bounded; values are opaque bearer tokens). */
export function orderSessionTokensFrom(cookies: { name: string; value: string }[]): string[] {
  return cookies
    .filter((c) => c.name.startsWith(ORDER_COOKIE_PREFIX) && c.value.length >= 40 && c.value.length <= 200)
    .slice(0, MAX_ORDER_SESSIONS)
    .map((c) => c.value);
}

type AccessClient = Tx | ReturnType<typeof db>;

/** How the viewer may see the order, or null. */
export async function orderAccess(orderId: string, viewer: OrderViewer, client: AccessClient = db()): Promise<{ via: "GUEST"; expiresAt: Date } | { via: "ORDER_SESSION"; expiresAt: Date } | null> {
  const order = await client.order.findUnique({ where: { id: orderId }, select: { guestSessionId: true, guestAccessRevokedAt: true } });
  if (!order) return null;
  if (viewer.guestSession && order.guestSessionId === viewer.guestSession.id && order.guestAccessRevokedAt === null) {
    return { via: "GUEST", expiresAt: viewer.guestSession.expiresAt };
  }
  if (viewer.orderSessionTokens.length > 0) {
    const session = await client.orderSession.findFirst({
      where: { orderId, sessionHash: { in: viewer.orderSessionTokens.map(hashToken) }, revokedAt: null, expiresAt: { gt: now() } },
      orderBy: { expiresAt: "desc" },
    });
    if (session) return { via: "ORDER_SESSION", expiresAt: session.expiresAt };
  }
  return null;
}

export async function canViewOrder(orderId: string, viewer: OrderViewer): Promise<boolean> {
  return (await orderAccess(orderId, viewer)) !== null;
}

/** Stable identity of the viewer for idempotency scopes and rate limits (no raw tokens). */
export function viewerKey(viewer: OrderViewer): string {
  if (viewer.guestSession) return `guest:${viewer.guestSession.id}`;
  if (viewer.orderSessionTokens.length > 0) return `order-session:${hashToken([...viewer.orderSessionTokens].sort().join("|"))}`;
  return "anonymous";
}
