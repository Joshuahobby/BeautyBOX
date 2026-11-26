import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { uploadStaffPhoto } from "@/lib/staff-photo-upload";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/api-client")>(), api: apiMock }));

const file = { type: "image/jpeg", size: 42 } as File;
const id = "fac18730-bb3f-44c0-9662-e4a5833cc897";
const intentKey = "web-31cef0de-5982-41d0-91f6-62ac1670591c";
const finalized = { storageKey: "products/fac18730-bb3f-44c0-9662-e4a5833cc897.webp", url: "/media/photo", reviewState: "PENDING_REVIEW", rejectReason: null };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  apiMock.mockReset();
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
});
afterEach(() => { globalThis.fetch = originalFetch; });

describe("bulk photo intent recovery", () => {
  it("records the upload ID before sending bytes or finalizing", async () => {
    const events: string[] = [];
    apiMock.mockImplementation(async (path: string) => {
      events.push(path);
      if (path === "/staff/media/upload-intents") return { uploadId: id, uploadUrl: "/upload" };
      return finalized;
    });
    vi.mocked(globalThis.fetch).mockImplementation(async () => {
      events.push("PUT");
      return { ok: true } as Response;
    });
    const result = await uploadStaffPhoto(file, "Photo", { intentKey, onIntent: (value) => {
      expect(value).toBe(id);
      events.push("checkpoint");
    } });
    expect(result).toEqual({ storageKey: finalized.storageKey, url: finalized.url });
    expect(events).toEqual(["/staff/media/upload-intents", "checkpoint", "PUT", `/staff/media/${id}/finalize`]);
    expect(apiMock.mock.calls[0]?.[1]).toMatchObject({ idempotencyKey: intentKey });
  });

  it("recovers a lost finalize response using the same upload without another PUT", async () => {
    apiMock.mockRejectedValueOnce(new ApiError(0, "NETWORK", "lost response"))
      .mockResolvedValueOnce(finalized);
    await expect(uploadStaffPhoto(file, "Photo", { uploadId: id, intentKey, onIntent: vi.fn() })).rejects.toMatchObject({ code: "NETWORK" });
    expect(await uploadStaffPhoto(file, "Photo", { uploadId: id, intentKey, onIntent: vi.fn() }))
      .toEqual({ storageKey: finalized.storageKey, url: finalized.url });
    expect(apiMock.mock.calls.map((call) => call[0])).toEqual([`/staff/media/${id}/finalize`, `/staff/media/${id}/finalize`]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("replays the original intent only when finalize confirms raw bytes are missing", async () => {
    apiMock.mockRejectedValueOnce(new ApiError(400, "VALIDATION_ERROR", "Upload the file before finishing."))
      .mockResolvedValueOnce({ uploadId: id, uploadUrl: "/upload" })
      .mockResolvedValueOnce(finalized);
    const result = await uploadStaffPhoto(file, "Photo", { uploadId: id, intentKey, onIntent: vi.fn() });
    expect(result).toEqual({ storageKey: finalized.storageKey, url: finalized.url });
    expect(apiMock.mock.calls[1]?.[1]).toMatchObject({ idempotencyKey: intentKey });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not mint a second intent when the saved upload has an uncertain result", async () => {
    apiMock.mockRejectedValueOnce(new ApiError(502, "UNCERTAIN", "unknown outcome"));
    await expect(uploadStaffPhoto(file, "Photo", { uploadId: id, intentKey, onIntent: vi.fn() })).rejects.toMatchObject({ code: "UNCERTAIN" });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
