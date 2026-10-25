import { afterEach, describe, expect, it } from "vitest";
import { mediaUrl, publicMediaBase, staffMediaUrl } from "@/modules/catalog/media";

// DR-041: storefront photo links point at the public bucket (or a configured CDN) when
// photos are in Supabase Storage; staff screens always use the app's guarded route.

const KEYS = ["APP_ORIGIN", "MEDIA_STORAGE", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_PUBLIC_MEDIA_BUCKET", "NEXT_PUBLIC_MEDIA_BASE_URL"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function set(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, values);
}

const key = "products/0b7c1d2e-1111-4222-8333-944455556666.webp";

describe("product photo URLs", () => {
  it("local storage serves everything through the app", () => {
    set({ APP_ORIGIN: "http://localhost:3000", MEDIA_STORAGE: "local" });
    expect(mediaUrl(key)).toBe(`http://localhost:3000/media/${key}`);
    expect(staffMediaUrl(key)).toBe(`http://localhost:3000/media/${key}`);
  });

  it("Supabase storage links the storefront to the public bucket and staff to the app", () => {
    set({ APP_ORIGIN: "https://shop.example", MEDIA_STORAGE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co/" });
    expect(publicMediaBase()).toBe("https://abc.supabase.co/storage/v1/object/public/product-photos");
    expect(mediaUrl(key)).toBe(`https://abc.supabase.co/storage/v1/object/public/product-photos/${key}`);
    expect(staffMediaUrl(key)).toBe(`https://shop.example/media/${key}`);
  });

  it("a configured media base (for example a CDN) wins", () => {
    set({ APP_ORIGIN: "https://shop.example", MEDIA_STORAGE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_MEDIA_BASE_URL: "https://img.shop.example/" });
    expect(mediaUrl(key)).toBe(`https://img.shop.example/${key}`);
  });

  it("refuses keys that try to leave their folder", () => {
    expect(() => mediaUrl("../.env.local")).toThrow();
    expect(() => staffMediaUrl("products/../../x")).toThrow();
  });
});
