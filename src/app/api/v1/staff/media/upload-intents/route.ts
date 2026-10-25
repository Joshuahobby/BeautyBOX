import type { NextRequest } from "next/server";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { staffFrom } from "@/server/http/staff";
import { mediaIntentInput } from "@/server/http/staff-schemas";
import { createUploadIntent } from "@/modules/media/uploads";

export const dynamic = "force-dynamic";

// Contract createMediaUploadIntent: the server chooses the storage location and key;
// only JPEG, PNG and WebP up to 10 MB are accepted (never SVG).
export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  const staff = await staffFrom(request, "catalog.write", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, mediaIntentInput);
  return jsonResponse(await createUploadIntent(staff, body, key, ctx.requestId), { requestId: ctx.requestId });
});
