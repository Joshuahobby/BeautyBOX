import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicMediaBase } from "@/modules/catalog/media";
import { accessCookieValue, gateDecision, SITE_ACCESS_COOKIE, type GateDecision } from "@/server/site-gate";

// Per-request Content-Security-Policy with a nonce for framework scripts and styles, plus
// Supabase staff-session refresh on /staff pages. No third-party scripts are loaded in
// Phase 1 (no analytics SDK, ADR-08); maps add their origins in I12.
//
// Styles (DR-039): production allows only same-origin stylesheets and <style> elements
// carrying this response's nonce. There is no 'unsafe-inline', so style="" attributes in
// server-rendered HTML are blocked; components use classes instead (ESLint forbids the
// style prop). Development keeps 'unsafe-inline' because the dev server injects <style>
// tags for hot reload; a nonce would make browsers ignore 'unsafe-inline'.

function supabaseOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** Origin serving public product photos when it is not this app (Supabase Storage or a CDN, DR-041). */
function mediaOrigin(appOrigin: string): string | null {
  try {
    const origin = new URL(publicMediaBase()).origin;
    return origin === appOrigin ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Pre-launch access wall (DR-044) for this request. It reads only its own settings (the full
 * configuration is validated by the app itself), and fails closed: with the wall on but no
 * verifier or key, no cookie can match, so everything behind it stays locked.
 */
function siteGate(request: NextRequest): GateDecision {
  const gate = process.env.SITE_GATE === "on" ? "on" : "off";
  const holdingHosts = (process.env.HOLDING_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (gate === "off" && holdingHosts.length === 0) return { kind: "pass" };
  const codeHash = process.env.SITE_ACCESS_CODE_HASH;
  const key = process.env.TOKEN_HASH_SECRET;
  return gateDecision(
    { host: request.headers.get("host") ?? request.nextUrl.host, pathname: request.nextUrl.pathname, cookie: request.cookies.get(SITE_ACCESS_COOKIE)?.value },
    { gate, holdingHosts, expectedCookie: codeHash && key && key.length >= 32 ? accessCookieValue(codeHash, key) : null },
  );
}

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function proxy(request: NextRequest) {
  const gate = siteGate(request);
  // API routes keep their own deny-all CSP (next.config.ts); the wall only answers for them.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    if (gate.kind === "pass") return NextResponse.next();
    return NextResponse.json({ code: "UNAUTHORIZED", message: "BeautyBOX is not open yet.", requestId: crypto.randomUUID() }, { status: 401, headers: PRIVATE_HEADERS });
  }
  if (gate.kind === "redirect") return NextResponse.redirect(new URL(gate.location, request.url), { status: 307, headers: PRIVATE_HEADERS });
  // No shortcut for prefetches: a browser can display a prefetched document, so it needs the
  // same nonce, CSP and staff-session handling as any page (Next strips its own router
  // prefetch headers before the proxy runs, so they could not be recognised here anyway).

  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV === "development";
  const https = request.nextUrl.protocol === "https:";
  const staffPage = request.nextUrl.pathname.startsWith("/staff");
  const supabase = supabaseOrigin();
  const media = mediaOrigin(request.nextUrl.origin);
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    `img-src 'self' blob: data:${media ? ` ${media}` : ""}`,
    "font-src 'self'",
    `connect-src 'self'${staffPage && supabase ? ` ${supabase}` : ""}${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-bb-requested-path");
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  if (gate.kind === "launch-page") {
    // Show "Launching soon" at the requested address; the page links back here after the code.
    requestHeaders.set("x-bb-requested-path", `${request.nextUrl.pathname}${request.nextUrl.search}`.slice(0, 512));
    const rewritten = NextResponse.rewrite(new URL("/launching-soon", request.url), { request: { headers: requestHeaders } });
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) rewritten.headers.set(name, value);
    rewritten.headers.set("Content-Security-Policy", csp);
    return rewritten;
  }
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // Keep the staff Supabase session fresh (rotated cookies are written to the response).
  if (staffPage && supabase && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          for (const c of cookies) request.cookies.set(c.name, c.value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const c of cookies) response.cookies.set(c.name, c.value, c.options);
        },
      },
    });
    await client.auth.getClaims().catch(() => null);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Every request, prefetches and API routes included, so nothing skips the access wall
      // (DR-044); API routes keep their own CSP.
      source: "/((?!_next/static|_next/image|icon.svg|favicon.ico).*)",
    },
  ],
};
