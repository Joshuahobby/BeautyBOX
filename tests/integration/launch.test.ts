import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { resetServerEnvForTests } from "@/server/env";
import { accessCookieValue, hashAccessCode, SITE_ACCESS_COOKIE } from "@/server/site-gate";
import { exportLaunchList, findInLaunchList, joinLaunchList, launchContactHash, purgeLaunchList, removeFromLaunchList, removeLaunchSignups } from "@/modules/launch/launch-list";
import { runHousekeeping } from "@/modules/ops/housekeeping";
import { isDomainError } from "@/modules/shared/errors";
import { POST as postLaunchList } from "@/app/api/v1/launch-list/route";
import { POST as postSiteAccess } from "@/app/api/v1/site-access/route";
import { proxy } from "@/proxy";
import { advanceSeconds, resetDatabase, startFreshRateLimitWindow } from "./harness";

// DR-044 (pre-launch wall) and DR-045 (launch list) against the real database.

const saved = { ...process.env };
const CODE = "Preview-Code-2026";
let codeHash = "";
const origin = () => new URL(process.env.APP_ORIGIN!).origin;
const appHost = () => new URL(process.env.APP_ORIGIN!).host;
const HOLDING = "beautyboxmarket.test";

async function configure(values: Record<string, string>) {
  Object.assign(process.env, values);
  resetServerEnvForTests();
}

beforeEach(async () => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  if (!codeHash) codeHash = await hashAccessCode(CODE);
  await configure({ LAUNCH_LIST: "open", LAUNCH_LIST_CONTACT_EMAIL: "hello@beautyboxmarket.test", HOLDING_HOSTS: HOLDING, SITE_GATE: "on", SITE_ACCESS_CODE_HASH: codeHash });
  await resetDatabase();
});
afterAll(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  resetServerEnvForTests();
});

const ctx = (client = "203.0.113.7") => ({ client, host: HOLDING });
const failure = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (isDomainError(e) ? e : null));

describe("launch list", () => {
  it("is refused while closed", async () => {
    await configure({ LAUNCH_LIST: "closed" });
    expect((await failure(joinLaunchList({ email: "a@example.test", consent: true }, ctx())))?.code).toBe("ACTION_NOT_ALLOWED");
    expect(await db().launchSignup.count()).toBe(0);
  });

  it("keeps an e-mail and/or a Rwanda mobile number, encrypted, with the consent version", async () => {
    await joinLaunchList({ email: "  Ama@Example.TEST ", consent: true }, ctx());
    await joinLaunchList({ phone: "078 123 4567", consent: true }, ctx());
    await joinLaunchList({ email: "both@example.test", phone: "+250 72 123 4567", consent: true }, ctx());
    const rows = await db().launchSignup.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(3);
    const raw = JSON.stringify(rows);
    for (const clear of ["ama@example.test", "0781234567", "+250781234567", "both@example.test", "+250721234567"]) expect(raw).not.toContain(clear);
    expect(rows.every((r) => r.consentVersion === "2026-11-24" && r.sourceHost === HOLDING)).toBe(true);
    expect(await exportLaunchList()).toEqual([
      expect.objectContaining({ email: "ama@example.test", phone: null }),
      expect.objectContaining({ email: null, phone: "+250781234567" }),
      expect.objectContaining({ email: "both@example.test", phone: "+250721234567" }),
    ]);
  });

  it("asks for a way to reach the person, valid details and the consent tick", async () => {
    expect((await failure(joinLaunchList({ consent: true }, ctx())))?.fieldErrors?.[0]?.field).toBe("email");
    expect((await failure(joinLaunchList({ email: "not-an-address", consent: true }, ctx())))?.fieldErrors?.[0]?.field).toBe("email");
    expect((await failure(joinLaunchList({ phone: "+1 202 555 0100", consent: true }, ctx())))?.fieldErrors?.[0]?.field).toBe("phone");
    expect((await failure(joinLaunchList({ email: "a@example.test", consent: false }, ctx())))?.fieldErrors?.[0]?.field).toBe("consent");
    expect(await db().launchSignup.count()).toBe(0);
  });

  it("a repeat sign-up refreshes the consent and lists a new detail on a row of its own, never a duplicate", async () => {
    await joinLaunchList({ email: "repeat@example.test", consent: true }, ctx());
    const first = await db().launchSignup.findFirstOrThrow();
    advanceSeconds(60);
    await joinLaunchList({ email: "REPEAT@example.test", phone: "0781234567", consent: true }, ctx());
    const rows = await db().launchSignup.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(first.id);
    expect(rows[0]!.phoneHash).toBeNull();
    expect(rows[0]!.consentedAt.getTime()).toBeGreaterThan(first.consentedAt.getTime());
    expect(rows[1]!.phoneHash).toBe(launchContactHash("phone", "+250781234567"));
    expect(rows[1]!.emailHash).toBeNull();
    expect(rows[1]!.linkedEmailHash).toBe(launchContactHash("email", "repeat@example.test"));
    // Both details already listed: nothing new is added.
    await joinLaunchList({ email: "repeat@example.test", phone: "078 123 4567", consent: true }, ctx());
    expect(await db().launchSignup.count()).toBe(2);
    // Withdrawal by e-mail shows the number typed with it later, for the operator to confirm.
    const found = await findInLaunchList("repeat@example.test");
    expect(found.entries).toEqual([expect.objectContaining({ email: "repeat@example.test", phone: null })]);
    expect(found.linked.map((l) => l.entry.phone)).toEqual(["+250781234567"]);
    const withdrawal = await removeFromLaunchList("repeat@example.test");
    expect(withdrawal.removed).toBe(1);
    expect(withdrawal.linked.map((l) => l.entry.phone)).toEqual(["+250781234567"]);
    expect(await removeLaunchSignups(withdrawal.linked.map((l) => l.id))).toBe(1);
    expect(await db().launchSignup.count()).toBe(0);
  });

  it("a shared phone never joins someone else's details: each person's removal takes only their own sign-up", async () => {
    await joinLaunchList({ phone: "0781234567", consent: true }, ctx()); // A
    const a = await db().launchSignup.findFirstOrThrow();
    advanceSeconds(60);
    await joinLaunchList({ email: "b@example.test", phone: "0781234567", consent: true }, ctx()); // B, same family phone
    expect(await db().launchSignup.count()).toBe(2);
    // B typed everything A's row holds, so A's row gets B's fresh consent too; B's e-mail is separate.
    expect((await db().launchSignup.findUniqueOrThrow({ where: { id: a.id } })).emailHash).toBeNull();
    // A withdraws the number: B's e-mail is shown as linked but kept unless A confirms it is theirs.
    const withdrawal = await removeFromLaunchList("078 123 4567");
    expect(withdrawal.removed).toBe(1);
    expect(withdrawal.linked.map((l) => l.entry.email)).toEqual(["b@example.test"]);
    expect((await exportLaunchList()).map((r) => [r.email, r.phone])).toEqual([["b@example.test", null]]);

    // A row holding a detail this sign-up did not give is not refreshed by it.
    await joinLaunchList({ email: "c@example.test", phone: "0721234567", consent: true }, ctx());
    const c = await db().launchSignup.findFirstOrThrow({ where: { emailHash: launchContactHash("email", "c@example.test") } });
    advanceSeconds(60);
    await joinLaunchList({ phone: "0721234567", consent: true }, ctx());
    expect((await db().launchSignup.findUniqueOrThrow({ where: { id: c.id } })).consentedAt).toEqual(c.consentedAt);
    expect(await db().launchSignup.count()).toBe(2);
  });

  it("two sign-ups at the same moment sharing a new e-mail keep both phone numbers", async () => {
    await Promise.all([
      joinLaunchList({ email: "race@example.test", phone: "0781111111", consent: true }, ctx("203.0.113.21")),
      joinLaunchList({ email: "race@example.test", phone: "0782222222", consent: true }, ctx("203.0.113.22")),
    ]);
    const listed = await exportLaunchList();
    expect(listed.filter((r) => r.email === "race@example.test")).toHaveLength(1);
    expect(listed.map((r) => r.phone).filter(Boolean).sort()).toEqual(["+250781111111", "+250782222222"]);
  });

  it("is rate-limited per address", async () => {
    startFreshRateLimitWindow();
    for (let i = 0; i < 10; i++) await joinLaunchList({ email: `p${i}@example.test`, consent: true }, ctx("198.51.100.9"));
    expect((await failure(joinLaunchList({ email: "p11@example.test", consent: true }, ctx("198.51.100.9"))))?.code).toBe("RATE_LIMITED");
    await joinLaunchList({ email: "elsewhere@example.test", consent: true }, ctx("198.51.100.10"));
  });

  it("finds and removes a person by e-mail or number, reading what a mail client shows, and refuses what it cannot read", async () => {
    await joinLaunchList({ email: "gone@example.test", phone: "0781234567", consent: true }, ctx());
    await joinLaunchList({ phone: "0721234567", consent: true }, ctx());
    await joinLaunchList({ email: "ama@example.test", consent: true }, ctx());
    expect(await findInLaunchList("mailto:Gone@Example.test")).toEqual({ entries: [expect.objectContaining({ email: "gone@example.test", phone: "+250781234567" })], linked: [] });
    expect(await removeFromLaunchList("Gone <Gone@Example.test>")).toEqual({ removed: 1, linked: [] }); // both details typed together go
    expect((await removeFromLaunchList("+250 72 123 4567")).removed).toBe(1);
    expect((await removeFromLaunchList("mailto:AMA@example.test")).removed).toBe(1);
    expect((await removeFromLaunchList("nobody@example.test")).removed).toBe(0);
    for (const unreadable of ["ama@", "Ama", "+1 202 555 0100", "078 123", "Ama <ama@x.test>, Bob <bob@y.test>", "ama@x.test bob@y.test"]) {
      expect((await failure(removeFromLaunchList(unreadable)))?.code, unreadable).toBe("VALIDATION_ERROR");
    }
    expect(await db().launchSignup.count()).toBe(0);
  });

  it("deletes sign-ups 12 months after the latest consent and spent rate-limit counters, from the job runner", async () => {
    await joinLaunchList({ email: "old@example.test", consent: true }, ctx("203.0.113.30"));
    advanceSeconds(366 * 24 * 3600);
    await joinLaunchList({ email: "new@example.test", consent: true }, ctx("203.0.113.31"));
    const buckets = async () => (await db().$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM commerce.rate_limit_buckets`)[0]!.n;
    expect(await buckets()).toBe(2);
    advanceSeconds(11 * 60); // the newer counter's 10-minute window is over too
    expect(await runHousekeeping()).toEqual({ launchSignupsDeleted: 1, rateLimitBucketsDeleted: 2 });
    expect((await exportLaunchList()).map((r) => r.email)).toEqual(["new@example.test"]);
    expect(await buckets()).toBe(0);
    expect(await purgeLaunchList(365)).toBe(0);
  });

  it("the sign-up endpoint accepts the shop's and the main domain's origin only, and answers the same for a repeat", async () => {
    const send = (from: string, body: unknown) =>
      postLaunchList(new NextRequest(`${origin()}/api/v1/launch-list`, { method: "POST", headers: { origin: from, "content-type": "application/json", "x-forwarded-for": "192.0.2.1" }, body: JSON.stringify(body) }), {
        params: Promise.resolve({}),
      });
    // The main domain is served by the same deployment, so on the shop's scheme and port.
    const app = new URL(origin());
    const port = app.port ? `:${app.port}` : "";
    const holdingOrigin = `${app.protocol}//${HOLDING}${port}`;
    const first = await send(holdingOrigin, { email: "web@example.test", consent: true });
    expect(first.status).toBe(202);
    const repeat = await send(origin(), { email: "web@example.test", consent: true });
    expect(repeat.status).toBe(202);
    expect(await repeat.json()).toEqual(await first.json());
    expect((await send(`${app.protocol}//${HOLDING}.${port}`, { email: "web@example.test", consent: true })).status).toBe(202); // the root's trailing dot
    expect((await send("https://evil.example", { email: "x@example.test", consent: true })).status).toBe(403);
    expect((await send(`${app.protocol}//${HOLDING}:8443`, { email: "x@example.test", consent: true })).status).toBe(403);
    expect((await send(`${app.protocol}//${HOLDING}.evil.example${port}`, { email: "x@example.test", consent: true })).status).toBe(403);
    expect((await send(origin(), { email: "x@example.test", consent: true, extra: 1 })).status).toBe(422);
    expect(await db().launchSignup.count()).toBe(1);
  });
});

describe("access code endpoint", () => {
  const send = (body: unknown, client = "192.0.2.50") =>
    postSiteAccess(new NextRequest(`${origin()}/api/v1/site-access`, { method: "POST", headers: { origin: origin(), "content-type": "application/json", "x-forwarded-for": client }, body: JSON.stringify(body) }), {
      params: Promise.resolve({}),
    });

  it("refuses a wrong code and sets the HttpOnly cookie for the right one, returning only a safe path", async () => {
    const wrong = await send({ code: "nope", next: "/checkout" });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    const right = await send({ code: CODE, next: "https://evil.example/x" });
    expect(right.status).toBe(200);
    expect(await right.json()).toEqual({ next: "/" });
    const cookie = right.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SITE_ACCESS_COOKIE}=${accessCookieValue(codeHash, process.env.TOKEN_HASH_SECRET!)}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).not.toContain(CODE);
  });

  it("slows down guessing per address", async () => {
    startFreshRateLimitWindow();
    for (let i = 0; i < 8; i++) expect((await send({ code: `guess-${i}` }, "192.0.2.77")).status).toBe(401);
    expect((await send({ code: CODE }, "192.0.2.77")).status).toBe(429);
    expect((await send({ code: CODE }, "192.0.2.78")).status).toBe(200);
  });
});

describe("the proxy applies the wall", () => {
  const request = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });

  it("shows 'Launching soon' and refuses APIs without the cookie; passes with it", async () => {
    const page = await proxy(request(`${origin()}/checkout`, { host: appHost() }));
    expect(page.headers.get("x-middleware-rewrite")).toBe(`${origin()}/launching-soon`);
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const api = await proxy(request(`${origin()}/api/v1/cart`, { host: appHost() }));
    expect(api.status).toBe(401);
    expect(await api.json()).toMatchObject({ code: "UNAUTHORIZED" });
    // A forged prefetch header does not skip the wall.
    expect((await proxy(request(`${origin()}/checkout`, { host: appHost(), "next-router-prefetch": "1" }))).headers.get("x-middleware-rewrite")).toBe(`${origin()}/launching-soon`);
    const cookie = `${SITE_ACCESS_COOKIE}=${accessCookieValue(codeHash, process.env.TOKEN_HASH_SECRET!)}`;
    const allowed = await proxy(request(`${origin()}/checkout`, { host: appHost(), cookie }));
    expect(allowed.headers.get("x-middleware-rewrite")).toBeNull();
    expect(allowed.headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(request(`${origin()}/api/v1/callbacks/pawapay`, { host: appHost() }))).headers.get("x-middleware-next")).toBe("1");
  });

  it("the main domain only ever shows the launch page", async () => {
    const base = `${new URL(origin()).protocol}//${HOLDING}`;
    expect((await proxy(request(`${base}/`, { host: HOLDING }))).headers.get("x-middleware-rewrite")).toBe(`${base}/launching-soon`);
    const away = await proxy(request(`${base}/shop`, { host: HOLDING }));
    expect(away.status).toBe(307);
    expect(away.headers.get("location")).toBe(`${base}/`);
    // Written with the root's trailing dot, the main domain is still the main domain.
    for (const path of ["/staff/sign-in", "/access", "/shop"]) {
      expect((await proxy(request(`${base}${path}`, { host: `${HOLDING}.` }))).status, path).toBe(307);
    }
    expect((await proxy(request(`${base}/api/v1/staff/orders`, { host: `${HOLDING.toUpperCase()}.` }))).status).toBe(401);
  });

  it("a page fetched as a prefetch still gets its nonce and CSP", async () => {
    const cookie = `${SITE_ACCESS_COOKIE}=${accessCookieValue(codeHash, process.env.TOKEN_HASH_SECRET!)}`;
    const prefetches: Record<string, string>[] = [{ purpose: "prefetch" }, { "next-router-prefetch": "1" }, { "sec-purpose": "prefetch;prerender" }];
    for (const headers of prefetches) {
      const page = await proxy(request(`${origin()}/checkout`, { host: appHost(), cookie, ...headers }));
      expect(page.headers.get("content-security-policy"), JSON.stringify(headers)).toMatch(/script-src 'self' 'nonce-/);
      expect(page.headers.get("x-middleware-override-headers"), JSON.stringify(headers)).toContain("x-nonce");
    }
  });

  it("with the wall on but no verifier, everything behind it stays locked", async () => {
    delete process.env.SITE_ACCESS_CODE_HASH;
    const cookie = `${SITE_ACCESS_COOKIE}=${accessCookieValue(codeHash, process.env.TOKEN_HASH_SECRET!)}`;
    expect((await proxy(request(`${origin()}/checkout`, { host: appHost(), cookie }))).headers.get("x-middleware-rewrite")).toBe(`${origin()}/launching-soon`);
  });
});
