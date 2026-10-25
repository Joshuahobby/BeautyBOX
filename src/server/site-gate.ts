import "server-only";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Pre-launch access wall (DR-044). Until launch, visitors without the access code see
// "Launching soon"; holding hosts (the main domain) show only that page. It is a curtain,
// not a security boundary: staff pages keep their own sign-in and MFA, provider callbacks
// their signatures, and the job runner its secret, so those paths pass through it.

export const SITE_ACCESS_COOKIE = "bb_site_access";
export const SITE_ACCESS_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Paths that never need the access code (each has its own protection, or is part of the wall). */
const OPEN_PREFIXES = [
  "/_next/",
  "/staff/",
  "/api/v1/staff/",
  "/api/v1/callbacks/",
  "/api/v1/internal/",
  "/media/",
];
const OPEN_EXACT = new Set(["/access", "/launching-soon", "/launch-privacy", "/api/v1/site-access", "/api/v1/launch-list", "/favicon.ico", "/icon.svg", "/robots.txt"]);
/** On a holding host only the launch page, its notice and the sign-up are served. */
const HOLDING_EXACT = new Set(["/launching-soon", "/launch-privacy", "/api/v1/launch-list", "/favicon.ico", "/icon.svg", "/robots.txt"]);

export type GateDecision =
  | { kind: "pass" }
  /** Show the launch page at this URL (rewrite, no redirect). */
  | { kind: "launch-page" }
  /** Send the browser to this path on the same host. */
  | { kind: "redirect"; location: string }
  /** API call without access: 401 with a JSON error. */
  | { kind: "locked-api" };

export type GateConfig = { gate: "on" | "off"; holdingHosts: readonly string[]; expectedCookie: string | null };

/** A host as compared with HOLDING_HOSTS: lower case, without a port or the root's trailing dot. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

function isOpenPath(pathname: string): boolean {
  return OPEN_EXACT.has(pathname) || OPEN_PREFIXES.some((p) => pathname === p.slice(0, -1) || pathname.startsWith(p));
}

/** Pure decision for one request; the proxy applies it. */
export function gateDecision(input: { host: string; pathname: string; cookie: string | undefined }, config: GateConfig): GateDecision {
  const host = normalizeHost(input.host);
  const { pathname } = input;
  if (config.holdingHosts.some((h) => normalizeHost(h) === host)) {
    if (pathname === "/") return { kind: "launch-page" };
    if (HOLDING_EXACT.has(pathname) || pathname.startsWith("/_next/")) return { kind: "pass" };
    return pathname.startsWith("/api/") ? { kind: "locked-api" } : { kind: "redirect", location: "/" };
  }
  if (config.gate === "off" || isOpenPath(pathname)) return { kind: "pass" };
  if (config.expectedCookie && input.cookie && safeEqual(input.cookie, config.expectedCookie)) return { kind: "pass" };
  return pathname.startsWith("/api/") ? { kind: "locked-api" } : { kind: "launch-page" };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * The cookie value that proves the access code was entered. It is derived from the code's
 * verifier, so changing the code signs everyone out; the key keeps it unguessable.
 */
export function accessCookieValue(codeHash: string, key: string): string {
  return `v1.${createHmac("sha256", key).update(`site-access:${codeHash}`, "utf8").digest("base64url")}`;
}

const SCRYPT = { N: 32_768, r: 8, p: 1, keyLength: 32 } as const;
const MAX_MEM = 128 * SCRYPT.N * SCRYPT.r * 2;

function derive(code: string, salt: Buffer, N: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(code.normalize("NFKC"), salt, keyLength, { N, r, p, maxmem: Math.max(MAX_MEM, 128 * N * r * 2) }, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

/**
 * scrypt:N:r:p:salt:hash (base64url): what SITE_ACCESS_CODE_HASH holds. Colons, not "$",
 * because .env loaders expand "$name" as a variable reference.
 */
export async function hashAccessCode(code: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(code, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLength);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join(":");
}

export async function verifyAccessCode(code: string, encoded: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = encoded.split(":");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const N = Number(n);
  // Bound the cost so a malformed setting cannot exhaust the function.
  if (!Number.isInteger(N) || N < 16_384 || N > 1_048_576 || Number(r) !== 8 || Number(p) !== 1 || expected.length !== 32) return false;
  const actual = await derive(code, Buffer.from(salt, "base64url"), N, 8, 1, expected.length);
  return timingSafeEqual(actual, expected);
}

/** Only same-site relative paths are followed after entering the code. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) return "/";
  if (next === "/access" || next.startsWith("/access?") || next === "/launching-soon") return "/";
  return next.slice(0, 512);
}
