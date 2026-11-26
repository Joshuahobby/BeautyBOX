"use client";
import { api, ApiError } from "@/lib/api-client";

type Recovery = { uploadId?: string; intentKey: string; onIntent: (uploadId: string) => void };

/** The editor uses the normal flow; bulk imports persist an intent before PUT/finalize. */
export async function uploadStaffPhoto(
  file: File,
  alt: string,
  recovery?: Recovery,
): Promise<{ storageKey: string; url: string } | { rejected: string }> {
  const finalize = (uploadId: string) => api<{
    storageKey: string; reviewState: string; url: string | null; rejectReason: string | null;
  }>(`/staff/media/${uploadId}/finalize`, { method: "POST", body: { alt } });
  const view = (result: Awaited<ReturnType<typeof finalize>>) =>
    result.reviewState === "REJECTED" || !result.url
      ? { rejected: result.rejectReason ?? "This photo was rejected." }
      : { storageKey: result.storageKey, url: result.url };
  if (recovery?.uploadId) {
    try {
      // Finalize is idempotent, including when its previous response was lost.
      return view(await finalize(recovery.uploadId));
    } catch (error) {
      // Only an explicitly missing raw upload permits another PUT. All uncertain
      // responses stop rather than creating a second derivative.
      if (!(error instanceof ApiError && error.code === "VALIDATION_ERROR" && error.message === "Upload the file before finishing.")) throw error;
    }
  }
  const intent = await api<{ uploadId: string; uploadUrl: string }>(
    "/staff/media/upload-intents",
    { method: "POST", idempotencyKey: recovery?.intentKey, body: { purpose: "PRODUCT_PHOTO", mimeType: file.type, sizeBytes: file.size } },
  );
  recovery?.onIntent(intent.uploadId);
  let put: Response;
  try {
    put = await fetch(intent.uploadUrl, {
      method: "PUT", body: file, headers: { "Content-Type": file.type }, credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "The photo could not be uploaded. Check your connection and try again.");
  }
  if (!put.ok) {
    const e = (await put.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiError(put.status, e.code ?? "INTERNAL_ERROR", e.message ?? "The photo could not be uploaded.");
  }
  return view(await finalize(intent.uploadId));
}
