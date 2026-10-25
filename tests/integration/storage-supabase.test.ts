import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { SupabaseMediaStorage } from "@/adapters/storage/supabase";
import { PUBLIC_PHOTO_CACHE_SECONDS } from "@/adapters/storage/types";

// DR-041: the Supabase Storage adapter against the REAL dev project buckets. Opt-in, because
// it needs the network and the project's secret key:
//   RUN_SUPABASE_STORAGE_TESTS=1 npx vitest run --project integration tests/integration/storage-supabase.test.ts
// Credentials come from .env.local (never printed). Objects are synthetic and removed at the end.

function localEnv(): Record<string, string> {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const enabled = process.env.RUN_SUPABASE_STORAGE_TESTS === "1";
const env = enabled ? localEnv() : {};
const PRIVATE = "private-media";
const PUBLIC = "product-photos";

describe.skipIf(!enabled)("Supabase Storage adapter (live dev project)", () => {
  // Built only when the suite is enabled: the describe body still runs while tests are collected.
  const storage = enabled ? new SupabaseMediaStorage(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, PRIVATE, PUBLIC) : (null as unknown as SupabaseMediaStorage);
  const staging = `staging/${randomUUID()}`;
  const photo = `products/${randomUUID()}.webp`;
  const missing = `products/${randomUUID()}.webp`;
  const publicUrl = (key: string) => `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PUBLIC}/${key}`;

  afterAll(async () => {
    await storage.deleteStaging(staging).catch(() => undefined);
    await storage.unpublish(photo).catch(() => undefined);
    // The private master is immutable for the app; tests remove it with the same client.
    await (storage as unknown as { client: { storage: { from(b: string): { remove(p: string[]): Promise<unknown> } } } }).client.storage.from(PRIVATE).remove([photo]);
  });

  it("takes a browser-style upload at the signed URL, then reads and deletes it", async () => {
    const jpeg = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#c96" } }).jpeg().toBuffer();
    const url = await storage.uploadTarget(staging);
    expect(url.startsWith(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/${PRIVATE}/${staging}?token=`)).toBe(true);
    const put = await fetch(url, { method: "PUT", body: new Uint8Array(jpeg), headers: { "Content-Type": "image/jpeg" } });
    expect(put.status).toBe(200);
    // A retried upload replaces the staged bytes.
    expect((await fetch(url, { method: "PUT", body: new Uint8Array(jpeg), headers: { "Content-Type": "image/jpeg" } })).status).toBe(200);
    expect((await storage.readStaging(staging))?.equals(jpeg)).toBe(true);
    // The bucket refuses types outside the allowlist.
    const svg = await fetch(url, { method: "PUT", body: "<svg/>", headers: { "Content-Type": "image/svg+xml" } });
    expect(svg.ok).toBe(false);
    await storage.deleteStaging(staging);
    expect(await storage.readStaging(staging)).toBeNull();
  });

  it("keeps derivatives private and immutable, and publishes and unpublishes copies idempotently", async () => {
    const webp = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#69c" } }).webp().toBuffer();
    await storage.putPrivate(photo, webp, "image/webp");
    await expect(storage.putPrivate(photo, webp, "image/webp")).rejects.toThrow(/storage_put_failed/);
    expect((await storage.readPrivate(photo))?.equals(webp)).toBe(true);
    expect(await storage.readPrivate(missing)).toBeNull();
    // Private means not readable at a public URL.
    expect((await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PRIVATE}/${photo}`)).ok).toBe(false);

    expect(await storage.isPublic(photo)).toBe(false);
    await storage.publish(photo);
    await storage.publish(photo); // already public: fine
    expect(await storage.isPublic(photo)).toBe(true);
    const res = await fetch(publicUrl(photo));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe(`public, max-age=${PUBLIC_PHOTO_CACHE_SECONDS}`);
    expect(Buffer.from(await res.arrayBuffer()).equals(webp)).toBe(true);

    await storage.unpublish(photo);
    await storage.unpublish(photo); // already gone: fine
    expect(await storage.isPublic(photo)).toBe(false);
    await expect(storage.publish(missing)).rejects.toThrow(/storage_publish_failed/);
  });
});
