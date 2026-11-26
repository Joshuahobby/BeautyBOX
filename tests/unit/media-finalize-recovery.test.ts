import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { StaffIdentity } from "@/modules/staff/identity";

const state = vi.hoisted(() => ({
  upload: {} as Record<string, unknown>,
  staging: null as Buffer | null,
  privateBytes: new Map<string, Buffer>(),
  failFinalizeUpdateOnce: false,
}));
vi.mock("@/server/db", () => ({
  db: () => ({
    mediaUpload: {
      findUnique: async () => ({ ...state.upload }),
      findUniqueOrThrow: async () => ({ ...state.upload }),
      updateMany: async ({ where, data }: { where: { state?: string; storageKey?: string | null }; data: Record<string, unknown> }) => {
        if (where.state && state.upload.state !== where.state) return { count: 0 };
        if (where.storageKey !== undefined && state.upload.storageKey !== where.storageKey) return { count: 0 };
        if (data.state === "FINALIZED" && state.failFinalizeUpdateOnce) {
          state.failFinalizeUpdateOnce = false;
          throw new Error("database update interrupted");
        }
        Object.assign(state.upload, data);
        return { count: 1 };
      },
    },
    $transaction: async (callback: (tx: object) => Promise<unknown>) => callback({}),
  }),
  transaction: vi.fn(),
}));
vi.mock("@/adapters/registry", () => ({
  mediaStorage: () => ({
    readStaging: async () => state.staging,
    deleteStaging: async () => { state.staging = null; },
    putPrivate: async (key: string, bytes: Buffer) => {
      if (state.privateBytes.has(key)) throw new Error("immutable object exists");
      state.privateBytes.set(key, bytes);
    },
    readPrivate: async (key: string) => state.privateBytes.get(key) ?? null,
  }),
}));
vi.mock("@/modules/audit/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/modules/staff/capabilities", () => ({ can: () => true }));

import { finalizeUpload } from "@/modules/media/uploads";
const uploadId = "fa1255cb-ce44-402d-b3c1-fd157cf68537";
const staffId = "ee452271-6adc-4636-8bd5-94b5d521bbcc";
const actor = { staffId, role: "ADMIN" } as StaffIdentity;
const key = `products/${uploadId}.webp`;

beforeEach(async () => {
  state.privateBytes.clear();
  state.failFinalizeUpdateOnce = false;
  state.staging = await sharp({ create: { width: 500, height: 500, channels: 3, background: "red" } }).png().toBuffer();
  state.upload = {
    id: uploadId, createdByStaffId: staffId, state: "INTENT", storageKey: null,
    stagingKey: `staging/${uploadId}`, declaredMimeType: "image/png", declaredBytes: state.staging.length,
    purpose: "PRODUCT_PHOTO", expiresAt: new Date(Date.now() + 600000), width: null, height: null,
  };
});

describe("server photo finalization recovery", () => {
  it("returns one immutable derivative for two overlapping finalizations", async () => {
    const results = await Promise.all([finalizeUpload(actor, uploadId, "Photo", null), finalizeUpload(actor, uploadId, "Photo", null)]);
    expect(results.map((result) => result.storageKey)).toEqual([key, key]);
    expect([...state.privateBytes.keys()]).toEqual([key]);
    expect(state.upload).toMatchObject({ state: "FINALIZED", storageKey: key });
  });

  it("recovers the reserved key after storage succeeded but the database update failed", async () => {
    state.failFinalizeUpdateOnce = true;
    await expect(finalizeUpload(actor, uploadId, "Photo", null)).rejects.toThrow("database update interrupted");
    expect(state.upload).toMatchObject({ state: "INTENT", storageKey: key });
    expect([...state.privateBytes.keys()]).toEqual([key]);
    const originalDerivative = state.privateBytes.get(key)!;
    // The signed staging URL may replace raw bytes; the immutable first
    // derivative, not the later raw upload, must remain canonical.
    state.staging = await sharp({ create: { width: 600, height: 400, channels: 3, background: "blue" } }).png().toBuffer();
    state.upload.expiresAt = new Date(Date.now() - 1000);
    const recovered = await finalizeUpload(actor, uploadId, "Photo", null);
    expect(recovered.storageKey).toBe(key);
    expect(state.upload.state).toBe("FINALIZED");
    expect([...state.privateBytes.keys()]).toEqual([key]);
    expect(state.privateBytes.get(key)).toEqual(originalDerivative);
  });

  it("finishes a reserved derivative after raw cleanup and intent expiry", async () => {
    state.failFinalizeUpdateOnce = true;
    await expect(finalizeUpload(actor, uploadId, "Photo", null)).rejects.toThrow("database update interrupted");
    state.staging = null;
    state.upload.expiresAt = new Date(Date.now() - 1000);
    const recovered = await finalizeUpload(actor, uploadId, "Photo", null);
    expect(recovered.storageKey).toBe(key);
    expect(state.upload).toMatchObject({ state: "FINALIZED", storageKey: key });
  });

  it("refuses an expired intent whose reserved key was never written, without creating any object", async () => {
    // Crash in the window between the DB reservation and the private write: there
    // is no derivative to recover, so the retry must stop cleanly instead of
    // minting a second key or resurrecting the expired intent.
    state.upload.storageKey = key;
    state.staging = null;
    state.upload.expiresAt = new Date(Date.now() - 1000);
    await expect(finalizeUpload(actor, uploadId, "Photo", null)).rejects.toThrow("expired without a stored photo");
    expect([...state.privateBytes.keys()]).toEqual([]);
    expect(state.upload).toMatchObject({ state: "INTENT", storageKey: key });
  });

  it("keeps the finalized derivative immutable when staging is replaced afterwards", async () => {
    // A signed staging URL stays valid briefly after finalize; replacing the raw
    // bytes must never change or duplicate the already-stored derivative.
    const first = await finalizeUpload(actor, uploadId, "Photo", null);
    const derivative = state.privateBytes.get(key)!;
    state.staging = await sharp({ create: { width: 700, height: 700, channels: 3, background: "green" } }).png().toBuffer();
    const replay = await finalizeUpload(actor, uploadId, "Photo", null);
    expect(replay.storageKey).toBe(first.storageKey);
    expect([...state.privateBytes.keys()]).toEqual([key]);
    expect(state.privateBytes.get(key)).toEqual(derivative);
  });
});
