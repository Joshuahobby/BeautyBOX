import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

// The production CSP the proxy sends (DR-039, DR-041): product photos may load from the
// public media origin on every page; the browser may talk to Supabase (sign-in, direct
// photo uploads) only on staff pages; nothing else is added.

const KEYS = ["MEDIA_STORAGE", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_MEDIA_BASE_URL", "SUPABASE_PUBLIC_MEDIA_BUCKET", "APP_ORIGIN"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function set(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, { APP_ORIGIN: "https://shop.example" }, values);
}

async function csp(path: string): Promise<Record<string, string>> {
  const res = await proxy(new NextRequest(`https://shop.example${path}`));
  const header = res.headers.get("content-security-policy") ?? "";
  return Object.fromEntries(
    header
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.split(" ")[0]!, d.slice(d.indexOf(" ") + 1)]),
  );
}

describe("content security policy from the proxy", () => {
  it("Supabase storage: photos from the Supabase origin everywhere; Supabase connections only on staff pages", async () => {
    set({ MEDIA_STORAGE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" });
    const shop = await csp("/");
    expect(shop["img-src"]).toBe("'self' blob: data: https://abc.supabase.co");
    expect(shop["connect-src"]).toBe("'self'");
    const staff = await csp("/staff/catalog/new");
    expect(staff["img-src"]).toBe("'self' blob: data: https://abc.supabase.co");
    expect(staff["connect-src"]).toBe("'self' https://abc.supabase.co");
    expect(staff["style-src"]).toMatch(/^'self' 'nonce-[^']+'$/);
  });

  it("a configured media base (a CDN) replaces the Supabase origin for images", async () => {
    set({ MEDIA_STORAGE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_MEDIA_BASE_URL: "https://img.shop.example/photos" });
    const shop = await csp("/shop");
    expect(shop["img-src"]).toBe("'self' blob: data: https://img.shop.example");
  });

  it("local storage adds no image origin", async () => {
    set({ MEDIA_STORAGE: "local" });
    expect((await csp("/"))["img-src"]).toBe("'self' blob: data:");
  });
});
