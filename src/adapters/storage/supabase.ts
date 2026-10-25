import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertMediaKey, PUBLIC_PHOTO_CACHE_SECONDS, type MediaStorage } from "./types";

// Supabase Storage (DR-041). Two buckets, created by the founder's go-ahead on 2026-10-24:
// - private ("private-media"): staging uploads and every finalized derivative. Not public;
//   storage.objects has row-level security with no policies, so only the server's secret
//   key and path-bound signed upload URLs can write, and only the secret key can read.
// - public ("product-photos"): copies of approved product photos, WebP only.
// The secret key is server-only and never leaves this module.

/** Storage calls give up well inside the 60 s job lease, so a stalled call cannot outlive it. */
export const STORAGE_TIMEOUT_MS = 15_000;

export class SupabaseMediaStorage implements MediaStorage {
  readonly provider = "SUPABASE" as const;
  private readonly client: SupabaseClient;

  constructor(
    url: string,
    secretKey: string,
    private readonly privateBucket: string,
    private readonly publicBucket: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    const timedFetch: typeof fetch = (input, init) => {
      const timeout = AbortSignal.timeout(STORAGE_TIMEOUT_MS);
      return fetchImpl(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
    };
    this.client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: timedFetch },
    });
  }

  private bucket(name: string) {
    return this.client.storage.from(name);
  }

  async uploadTarget(stagingKey: string): Promise<string> {
    assertMediaKey(stagingKey);
    // A signed URL for exactly this path, valid for 2 hours (Supabase's fixed lifetime);
    // it can be used more than once in that time. upsert lets a retried upload replace the
    // staged bytes; the bucket enforces the 10 MB limit and the JPEG/PNG/WebP allowlist,
    // and finalize decodes, size-checks and re-encodes whatever arrived. URLs are issued
    // only for an open, unexpired intent (src/modules/media/uploads.ts).
    const { data, error } = await this.bucket(this.privateBucket).createSignedUploadUrl(stagingKey, { upsert: true });
    if (error || !data) throw new Error(`storage_signed_upload_failed: ${error?.message ?? "no data"}`);
    return data.signedUrl;
  }

  async putStaging(key: string, bytes: Buffer, contentType: string): Promise<void> {
    assertMediaKey(key);
    const { error } = await this.bucket(this.privateBucket).upload(key, bytes, { contentType, upsert: true });
    if (error) throw new Error(`storage_put_failed: ${error.message}`);
  }

  async readStaging(key: string): Promise<Buffer | null> {
    return this.read(key);
  }

  async deleteStaging(key: string): Promise<void> {
    assertMediaKey(key);
    const { error } = await this.bucket(this.privateBucket).remove([key]);
    if (error) throw new Error(`storage_delete_failed: ${error.message}`);
  }

  async putPrivate(key: string, bytes: Buffer, contentType: string): Promise<void> {
    assertMediaKey(key);
    const { error } = await this.bucket(this.privateBucket).upload(key, bytes, {
      contentType,
      upsert: false, // immutable keys
      cacheControl: String(PUBLIC_PHOTO_CACHE_SECONDS), // copied with the object when published
    });
    if (error) throw new Error(`storage_put_failed: ${error.message}`);
  }

  async readPrivate(key: string): Promise<Buffer | null> {
    return this.read(key);
  }

  async publish(key: string): Promise<void> {
    assertMediaKey(key);
    const { error } = await this.bucket(this.privateBucket).copy(key, key, { destinationBucket: this.publicBucket });
    // Keys are immutable, so an existing public copy is the same photo.
    if (error && errorCode(error) !== "ResourceAlreadyExists" && !/already exists/i.test(error.message)) throw new Error(`storage_publish_failed: ${error.message}`);
  }

  async unpublish(key: string): Promise<void> {
    assertMediaKey(key);
    const { error } = await this.bucket(this.publicBucket).remove([key]);
    if (error) throw new Error(`storage_unpublish_failed: ${error.message}`);
  }

  /** Test and inspection hook: whether a public copy exists (asks the API, not the CDN). */
  async isPublic(key: string): Promise<boolean> {
    assertMediaKey(key);
    const { data, error } = await this.bucket(this.publicBucket).exists(key);
    if (error) {
      // The Storage API answers a missing object with 400 or 404 rather than "false".
      const details = error as { status?: number; statusCode?: string };
      if (details.status === 400 || details.status === 404 || details.statusCode === "400" || details.statusCode === "404") return false;
      throw new Error(`storage_exists_failed: ${error.message}`);
    }
    return data;
  }

  private async read(key: string): Promise<Buffer | null> {
    assertMediaKey(key);
    const { data, error } = await this.bucket(this.privateBucket).download(key);
    if (error) {
      const details = error as { status?: number; statusCode?: string };
      if (errorCode(error) === "NoSuchKey" || details.status === 404 || details.statusCode === "404" || /not found/i.test(error.message)) return null;
      throw new Error(`storage_read_failed: ${error.message}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}
