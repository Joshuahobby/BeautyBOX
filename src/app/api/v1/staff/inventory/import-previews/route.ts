import type { NextRequest } from "next/server";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { importPreviewInput } from "@/server/http/staff-schemas";
import { previewStockImport } from "@/modules/inventory/admin";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { DomainError } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";
const MAX_IMPORT_BYTES = 512 * 1024;

export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  const staff = await staffFrom(request, "stock.import", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  // Imports are larger than ordinary mutations; bounded separately (1000 rows max).
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) throw new DomainError("VALIDATION_ERROR", "Import file is too large.", { httpStatus: 400 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "Import body is not valid JSON.", { httpStatus: 400 });
  }
  const parsed = importPreviewInput.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", "Check the import rows.", {
      fieldErrors: parsed.error.issues.slice(0, 50).map((i) => ({ field: i.path.join("."), message: "Invalid value." })),
    });
  }
  return jsonResponse(await previewStockImport(staff, parsed.data.rows, key, ctx.requestId), { status: 201, requestId: ctx.requestId });
});
