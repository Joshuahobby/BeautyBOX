import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { LocalMediaStorage } from "@/adapters/storage/local";
import { SupabaseMediaStorage } from "@/adapters/storage/supabase";

// Storage adapter edge cases that must hold on every run (DR-041). The Supabase adapter is
// driven with simulated Storage API answers shaped like the live ones recorded on
// 2026-10-24 (tests/integration/storage-supabase.test.ts runs it against the real buckets).

type Answer = { status: number; body?: unknown };

function fakeSupabase(answer: (method: string, url: string) => Answer) {
  const calls: { method: string; url: string; hasSignal: boolean }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, hasSignal: init?.signal instanceof AbortSignal });
    const a = answer(method, url);
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { storage: new SupabaseMediaStorage("https://abc.supabase.co", "test-secret", "private-media", "product-photos", fetchImpl), calls };
}

const key = `products/${randomUUID()}.webp`;
const notFound = { status: 400, body: { statusCode: "404", error: "not_found", message: "Object not found" } };

describe("Supabase storage adapter, simulated API", () => {
  it("treats an existing public copy as published, and other copy failures as errors", async () => {
    const dup = fakeSupabase(() => ({ status: 400, body: { statusCode: "409", error: "Duplicate", message: "The resource already exists" } }));
    await expect(dup.storage.publish(key)).resolves.toBeUndefined();
    expect(dup.calls[0]).toMatchObject({ method: "POST", hasSignal: true });
    expect(dup.calls[0]!.url).toContain("/storage/v1/object/copy");

    const broken = fakeSupabase(() => ({ status: 500, body: { statusCode: "500", error: "internal", message: "boom" } }));
    await expect(broken.storage.publish(key)).rejects.toThrow(/storage_publish_failed/);
  });

  it("reads a missing object as null, but a failing read as an error", async () => {
    const missing = fakeSupabase(() => notFound);
    expect(await missing.storage.readPrivate(key)).toBeNull();
    const failing = fakeSupabase(() => ({ status: 500, body: { statusCode: "500", error: "internal", message: "boom" } }));
    await expect(failing.storage.readPrivate(key)).rejects.toThrow(/storage_read_failed/);
  });

  it("reports whether a public copy exists", async () => {
    expect(await fakeSupabase(() => ({ status: 400 })).storage.isPublic(key)).toBe(false);
    expect(await fakeSupabase(() => ({ status: 200 })).storage.isPublic(key)).toBe(true);
  });

  it("deletes a batch of raw uploads in one request, and refuses any key that is not a raw upload", async () => {
    const s = fakeSupabase(() => ({ status: 200, body: [] }));
    const keys = [`staging/${randomUUID()}`, `staging/${randomUUID()}`];
    await s.storage.deleteStagingMany(keys);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ method: "DELETE", hasSignal: true });
    expect(s.calls[0]!.url).toContain("/storage/v1/object/private-media");
    await s.storage.deleteStagingMany([]);
    await expect(s.storage.deleteStagingMany([`staging/${randomUUID()}`, key])).rejects.toThrow(/Invalid staging key/);
    expect(s.calls).toHaveLength(1);
    const failing = fakeSupabase(() => ({ status: 500, body: { statusCode: "500", error: "internal", message: "boom" } }));
    await expect(failing.storage.deleteStagingMany(keys)).rejects.toThrow(/storage_delete_failed/);
  });

  it("refuses keys it did not generate before calling Supabase", async () => {
    const s = fakeSupabase(() => ({ status: 200 }));
    await expect(s.storage.publish("../private-media/evidence/x.webp")).rejects.toThrow(/Invalid media key/);
    await expect(s.storage.uploadTarget("products/not-a-staging-key")).rejects.toThrow(/Invalid media key/);
    expect(s.calls).toHaveLength(0);
  });
});

describe("local storage adapter", () => {
  const root = path.join(os.tmpdir(), `bb-media-${randomUUID()}`);
  afterAll(() => fs.rm(root, { recursive: true, force: true }));

  it("bulk-deletes raw uploads only, ignoring ones already gone", async () => {
    const storage = new LocalMediaStorage(root, "http://localhost:3000");
    const raw = `staging/${randomUUID()}`;
    const photo = `products/${randomUUID()}.webp`;
    await storage.putStaging(raw, Buffer.from("raw"));
    await storage.putPrivate(photo, Buffer.from("photo"));
    await storage.deleteStagingMany([raw, `staging/${randomUUID()}`]);
    expect(await storage.readStaging(raw)).toBeNull();
    await expect(storage.deleteStagingMany([photo])).rejects.toThrow(/Invalid staging key/);
    expect((await storage.readPrivate(photo))?.toString()).toBe("photo");
  });

  it("keeps a photo stored before DR-041 (public area only) when it is unpublished", async () => {
    const storage = new LocalMediaStorage(root, "http://localhost:3000");
    const legacy = `products/${randomUUID()}.webp`;
    await fs.mkdir(path.join(root, "public", "products"), { recursive: true });
    await fs.writeFile(path.join(root, "public", legacy), Buffer.from("legacy-photo"));

    await storage.unpublish(legacy);
    expect(await storage.isPublic(legacy)).toBe(false);
    expect((await storage.readPrivate(legacy))?.toString()).toBe("legacy-photo");
    await storage.publish(legacy);
    expect(await storage.isPublic(legacy)).toBe(true);
  });
});
