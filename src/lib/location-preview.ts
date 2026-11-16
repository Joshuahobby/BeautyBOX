import type { Point } from "@/lib/types";

export function manualPoint(latitude: string, longitude: string): Point | null {
  if (!latitude.trim() || !longitude.trim()) return null;
  const lat = Number(latitude),
    lng = Number(longitude);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

/** Only the separate browser Embed key is accepted. Never fall back to a server key. */
export function mapEmbedUrl(
  point: Point | null,
  browserKey?: string,
): string | null {
  if (
    !point ||
    !browserKey ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(browserKey) ||
    !manualPoint(String(point.lat), String(point.lng))
  )
    return null;
  const url = new URL("https://www.google.com/maps/embed/v1/place");
  url.searchParams.set("key", browserKey);
  url.searchParams.set("q", `${point.lat},${point.lng}`);
  url.searchParams.set("zoom", "17");
  return url.toString();
}
