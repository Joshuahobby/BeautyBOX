import type { NextRequest } from "next/server";
import {
  assertSameOrigin,
  idempotencyKeyFrom,
  jsonResponse,
  readJson,
  withApi,
} from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { importPreviewInput } from "@/server/http/staff-schemas";
import { previewStockImport } from "@/modules/inventory/admin";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";
const MAX_IMPORT_BYTES = 512 * 1024;

export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  const staff = await staffFrom(request, "stock.import", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  // Imports are larger than ordinary mutations; bounded separately (1000 rows max).
  const input = await readJson(request, importPreviewInput, {
    maxBytes: MAX_IMPORT_BYTES,
  });
  return jsonResponse(
    await previewStockImport(staff, input.rows, key, ctx.requestId),
    { status: 201, requestId: ctx.requestId },
  );
});
