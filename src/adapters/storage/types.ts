// Media storage contract (DR-041). Keys are server-generated and immutable; the browser
// never chooses a key or a bucket.
//
// - Staging: the raw upload for an intent, overwritable until it is finalized.
// - Private: every finalized derivative (product photo masters and evidence). Never
//   publicly readable; staff previews are served through the app's guarded /media route.
// - Public: copies of APPROVED product photos only, made by publish() and removed by
//   unpublish(). The storefront links straight to them.

export interface MediaStorage {
  readonly provider: "LOCAL" | "SUPABASE";
  /** Where the browser PUTs the raw upload for an intent (body = file, Content-Type = declared type). */
  uploadTarget(stagingKey: string): Promise<string>;
  putStaging(key: string, bytes: Buffer, contentType: string): Promise<void>;
  readStaging(key: string): Promise<Buffer | null>;
  deleteStaging(key: string): Promise<void>;
  /** Stores a finalized derivative privately. Keys are immutable: an existing key is never overwritten. */
  putPrivate(key: string, bytes: Buffer, contentType: string): Promise<void>;
  readPrivate(key: string): Promise<Buffer | null>;
  /** Makes an approved product photo readable at its public URL. Idempotent. */
  publish(key: string): Promise<void>;
  /** Removes the public copy. Idempotent. A CDN may keep serving it until its cache time ends. */
  unpublish(key: string): Promise<void>;
}

/** Product photo derivatives: browser caches and the CDN keep them for this long (also the takedown delay). */
export const PUBLIC_PHOTO_CACHE_SECONDS = 600;

/** Server-generated keys only: products/<uuid>.webp, evidence/<uuid>.webp, staging/<uuid>. */
export const MEDIA_KEY = /^(?:products\/[0-9a-f-]{36}\.webp|evidence\/[0-9a-f-]{36}\.webp|staging\/[0-9a-f-]{36})$/;
export const PRODUCT_PHOTO_KEY = /^products\/[0-9a-f-]{36}\.webp$/;

export function assertMediaKey(key: string): void {
  if (!MEDIA_KEY.test(key)) throw new Error("Invalid media key");
}
