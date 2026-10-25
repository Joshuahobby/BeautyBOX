import { describe, expect, it } from "vitest";
import { accessCookieValue, gateDecision, hashAccessCode, safeNextPath, verifyAccessCode, type GateConfig } from "@/server/site-gate";

// DR-044: the pre-launch wall. Visitors without the code see "Launching soon"; the main domain
// shows only that; staff, provider callbacks, the job runner and the wall itself pass.

const KEY = "k".repeat(40);
const HASH = "scrypt:32768:8:1:c2FsdHNhbHRzYWx0c2FsdA:aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g";
const cookie = accessCookieValue(HASH, KEY);
const on: GateConfig = { gate: "on", holdingHosts: ["beautyboxmarket.com", "www.beautyboxmarket.com"], expectedCookie: cookie };
const decide = (pathname: string, opts: { host?: string; cookie?: string; config?: GateConfig } = {}) =>
  gateDecision({ host: opts.host ?? "staging.beautyboxmarket.com", pathname, cookie: opts.cookie }, opts.config ?? on);

describe("access wall decisions", () => {
  it("shows the launch page for shop pages and refuses shop APIs without the code", () => {
    for (const path of ["/", "/shop", "/products/gloss-clear", "/cart", "/checkout", "/orders/123", "/help/privacy", "/dev/sms", "/order-access"]) {
      expect(decide(path), path).toEqual({ kind: "launch-page" });
    }
    for (const path of ["/api/v1/cart", "/api/v1/checkouts", "/api/v1/payments", "/api/v1/products", "/api/v1/places"]) {
      expect(decide(path), path).toEqual({ kind: "locked-api" });
    }
  });

  it("lets through the wall's own pages, staff, signed callbacks, the job runner and assets", () => {
    for (const path of [
      "/access",
      "/launching-soon",
      "/launch-privacy",
      "/api/v1/site-access",
      "/api/v1/launch-list",
      "/staff",
      "/staff/orders",
      "/api/v1/staff/orders",
      "/api/v1/callbacks/pawapay",
      "/api/v1/internal/jobs/run",
      "/_next/static/chunk.js",
      "/robots.txt",
      "/favicon.ico",
    ]) {
      expect(decide(path), path).toEqual({ kind: "pass" });
    }
    // Look-alike paths are not exempt.
    expect(decide("/staffing")).toEqual({ kind: "launch-page" });
    expect(decide("/api/v1/staffroom")).toEqual({ kind: "locked-api" });
  });

  it("passes everything with the right cookie, and nothing with a wrong or stale one", () => {
    expect(decide("/checkout", { cookie })).toEqual({ kind: "pass" });
    expect(decide("/api/v1/cart", { cookie })).toEqual({ kind: "pass" });
    expect(decide("/checkout", { cookie: `${cookie}x` })).toEqual({ kind: "launch-page" });
    expect(decide("/checkout", { cookie: accessCookieValue(HASH.replace("aGFz", "bGFz"), KEY) })).toEqual({ kind: "launch-page" });
    expect(decide("/checkout", { cookie: accessCookieValue(HASH, "other-key".repeat(5)) })).toEqual({ kind: "launch-page" });
  });

  it("holding hosts show only the launch page, whatever cookie is sent", () => {
    const host = "beautyboxmarket.com";
    expect(decide("/", { host, cookie })).toEqual({ kind: "launch-page" });
    expect(decide("/", { host: "WWW.BeautyBoxMarket.com:443" })).toEqual({ kind: "launch-page" });
    // The root's trailing dot names the same host.
    for (const path of ["/staff/sign-in", "/access", "/media/x"]) expect(decide(path, { host: "beautyboxmarket.com.", cookie }), path).toEqual({ kind: "redirect", location: "/" });
    expect(decide("/api/v1/staff/orders", { host: "beautyboxmarket.com.:443" })).toEqual({ kind: "locked-api" });
    for (const path of ["/launching-soon", "/launch-privacy", "/api/v1/launch-list", "/_next/static/a.css", "/robots.txt"]) expect(decide(path, { host }), path).toEqual({ kind: "pass" });
    for (const path of ["/shop", "/access", "/staff", "/checkout"]) expect(decide(path, { host, cookie }), path).toEqual({ kind: "redirect", location: "/" });
    for (const path of ["/api/v1/cart", "/api/v1/callbacks/pawapay", "/api/v1/site-access"]) expect(decide(path, { host }), path).toEqual({ kind: "locked-api" });
  });

  it("is open when the wall is off (holding hosts still hold)", () => {
    const off: GateConfig = { ...on, gate: "off" };
    expect(decide("/checkout", { config: off })).toEqual({ kind: "pass" });
    expect(decide("/api/v1/cart", { config: off })).toEqual({ kind: "pass" });
    expect(decide("/shop", { config: off, host: "beautyboxmarket.com" })).toEqual({ kind: "redirect", location: "/" });
  });
});

describe("access code", () => {
  it("is stored as a salted scrypt verifier that checks the right code only", async () => {
    const encoded = await hashAccessCode("Pr3view-Code!");
    expect(encoded).toMatch(/^scrypt:32768:8:1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain("Pr3view-Code!");
    expect(await hashAccessCode("Pr3view-Code!")).not.toBe(encoded); // fresh salt
    expect(await verifyAccessCode("Pr3view-Code!", encoded)).toBe(true);
    expect(await verifyAccessCode("pr3view-code!", encoded)).toBe(false);
    expect(await verifyAccessCode("", encoded)).toBe(false);
  });

  it("refuses malformed or overly costly verifiers instead of running them", async () => {
    expect(await verifyAccessCode("x", "plain")).toBe(false);
    expect(await verifyAccessCode("x", "scrypt:1024:8:1:c2FsdA:aGFzaA")).toBe(false);
    expect(await verifyAccessCode("x", "scrypt:4194304:8:1:c2FsdHNhbHRzYWx0c2FsdA:aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g")).toBe(false);
  });
});

describe("return path after the code", () => {
  it("follows only same-site relative paths", () => {
    expect(safeNextPath("/checkout?step=2")).toBe("/checkout?step=2");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", undefined, 42, "/access", "/access?next=/x", "/launching-soon", "/a\nb"]) {
      expect(safeNextPath(bad), String(bad)).toBe("/");
    }
  });
});
