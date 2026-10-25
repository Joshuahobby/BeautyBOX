import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/server/env";
import { GUEST_COOKIE, requireGuestSession, resolveGuestSession } from "@/modules/session/guest-session";
import { orderCookieName, orderSessionTokensFrom, type OrderViewer } from "@/modules/orders/access";

const secureCookies = () => serverEnv().APP_ORIGIN.startsWith("https://");

export function setGuestCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set(GUEST_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function setOrderCookie(response: NextResponse, orderId: string, token: string, expiresAt: Date) {
  response.cookies.set(orderCookieName(orderId), token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}

export const guestFrom = (request: NextRequest) => requireGuestSession(request.cookies.get(GUEST_COOKIE)?.value);

export async function viewerFrom(request: NextRequest): Promise<OrderViewer> {
  return {
    guestSession: await resolveGuestSession(request.cookies.get(GUEST_COOKIE)?.value),
    orderSessionTokens: orderSessionTokensFrom(request.cookies.getAll()),
  };
}
