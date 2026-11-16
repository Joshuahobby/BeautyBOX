import "server-only";

export type GoogleTransport = typeof fetch;
export type GoogleReply = { ok: true; value: unknown } | { ok: false };

// Fixed endpoints are chosen by the adapters. Never follow redirects, retry, cache,
// log response bodies or put credentials in a URL. Bound timeout and streamed bytes.
export async function googleJson(
  url: string,
  key: string,
  init: RequestInit,
  transport: GoogleTransport = fetch,
): Promise<GoogleReply> {
  try {
    const response = await transport(url, {
      ...init,
      headers: { ...init.headers, "X-Goog-Api-Key": key },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return { ok: false };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 256 * 1024) {
          await reader.cancel();
          return { ok: false };
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    return { ok: true, value: JSON.parse(bytes.toString("utf8")) };
  } catch {
    return { ok: false };
  }
}
