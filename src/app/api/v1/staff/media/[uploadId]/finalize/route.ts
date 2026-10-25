import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { staffFrom } from "@/server/http/staff";
import { mediaFinalizeInput } from "@/server/http/staff-schemas";
import { finalizeUpload } from "@/modules/media/uploads";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract finalizeMedia: decode and verify the bytes, then store a safe derivative.
export const POST = withApi<{ uploadId: string }>(async (request: NextRequest, { uploadId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(uploadId).success) throw notFound();
  const staff = await staffFrom(request, "catalog.write", ctx.requestId);
  // Finalizing is idempotent by itself (a second call returns the same result); the key
  // is still required by the contract.
  validateIdempotencyKey(idempotencyKeyFrom(request));
  const { alt } = await readJson(request, mediaFinalizeInput);
  return jsonResponse(await finalizeUpload(staff, uploadId, alt, ctx.requestId), { requestId: ctx.requestId });
});
