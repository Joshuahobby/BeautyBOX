import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { importApplyInput } from "@/server/http/staff-schemas";
import { applyStockImport } from "@/modules/inventory/admin";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const POST = withApi<{ previewId: string }>(async (request: NextRequest, { previewId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(previewId).success) throw notFound();
  const staff = await staffFrom(request, "stock.import", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, importApplyInput);
  return jsonResponse(await applyStockImport(staff, previewId, body, key, ctx.requestId), { requestId: ctx.requestId });
});
