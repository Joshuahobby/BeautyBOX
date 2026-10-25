// Product photo URLs (DR-041). Storage keys are immutable and allowlisted at upload (I08);
// this module only turns a key into an absolute URL (the API contract declares image URLs
// as format: uri).
//
// - mediaUrl: the public URL of an APPROVED photo, for the storefront. With Supabase
//   Storage it points at the public bucket (or NEXT_PUBLIC_MEDIA_BASE_URL, e.g. a CDN
//   domain); locally at the app's /media route.
// - staffMediaUrl: the app's guarded /media route, for staff screens. It serves a photo
//   still awaiting review to signed-in staff and works before the public copy exists.

const KEY = /^[a-z0-9][a-z0-9/_.-]{2,200}$/i;

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function checked(storageKey: string): string {
  if (!KEY.test(storageKey) || storageKey.includes("..")) throw new Error("Invalid media storage key");
  return storageKey;
}

function appMediaBase(): string {
  return `${trimSlash(process.env.APP_ORIGIN ?? "http://localhost:3000")}/media`;
}

/** Base URL for public product photos; also used by the CSP's img-src. */
export function publicMediaBase(): string {
  const configured = process.env.NEXT_PUBLIC_MEDIA_BASE_URL;
  if (configured) return trimSlash(configured);
  if (process.env.MEDIA_STORAGE === "supabase" && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const bucket = process.env.SUPABASE_PUBLIC_MEDIA_BUCKET || "product-photos";
    return `${trimSlash(process.env.NEXT_PUBLIC_SUPABASE_URL)}/storage/v1/object/public/${bucket}`;
  }
  return appMediaBase();
}

export function mediaUrl(storageKey: string): string {
  return `${publicMediaBase()}/${checked(storageKey)}`;
}

export function staffMediaUrl(storageKey: string): string {
  return `${appMediaBase()}/${checked(storageKey)}`;
}
