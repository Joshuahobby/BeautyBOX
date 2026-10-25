import type { NextRequest } from "next/server";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { stockAdjustmentInput } from "@/server/http/staff-schemas";
import { adjustStock } from "@/modules/inventory/admin";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";

export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  const staff = await staffFrom(request, "stock.adjust", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, stockAdjustmentInput);
  return jsonResponse(await adjustStock(staff, body, key, ctx.requestId), { requestId: ctx.requestId });
});
