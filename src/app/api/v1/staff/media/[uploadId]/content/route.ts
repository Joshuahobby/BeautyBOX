import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, jsonResponse, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { MAX_UPLOAD_BYTES, receiveUploadContent } from "@/modules/media/uploads";
import { DomainError, notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

async function boundedBody(request: NextRequest): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) throw new DomainError("VALIDATION_ERROR", "Photos must be 10 MB or smaller.", { httpStatus: 413 });
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPLOAD_BYTES) {
      await reader.cancel();
      throw new DomainError("VALIDATION_ERROR", "Photos must be 10 MB or smaller.", { httpStatus: 413 });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Local-storage upload target for an intent (hosted storage uses a signed URL instead).
// Only the staff member who created the intent can send its bytes.
export const PUT = withApi<{ uploadId: string }>(async (request: NextRequest, { uploadId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(uploadId).success) throw notFound();
  const staff = await staffFrom(request, "catalog.write", ctx.requestId);
  await receiveUploadContent(staff, uploadId, request.headers.get("content-type"), await boundedBody(request));
  return jsonResponse({ uploadId, received: true }, { requestId: ctx.requestId });
});
