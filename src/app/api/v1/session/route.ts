import type { NextRequest } from "next/server";
import { assertSameOrigin, clientAddress, jsonResponse, withApi } from "@/server/http/api";
import { rateLimit } from "@/server/http/rate-limit";
import { setGuestCookie } from "@/server/http/session";
import { GUEST_COOKIE, createOrReuseGuestSession, resolveGuestSession } from "@/modules/session/guest-session";

export const dynamic = "force-dynamic";

export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  const existing = request.cookies.get(GUEST_COOKIE)?.value;
  // Limit every request that would create a session, including ones carrying a stale or
  // forged cookie, not just requests without a cookie.
  if (!(await resolveGuestSession(existing))) await rateLimit("session", clientAddress(request));
  const { session, token } = await createOrReuseGuestSession(existing);
  const response = jsonResponse({ expiresAt: session.expiresAt.toISOString() }, { requestId: ctx.requestId });
  if (token) setGuestCookie(response, token, session.expiresAt);
  return response;
});
