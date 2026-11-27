import type { NextRequest } from "next/server";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { bulkActionInput } from "@/server/http/staff-schemas";
import { bulkSetPublication } from "@/modules/catalog/admin";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";

export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  const staff = await staffFrom(request, "catalog.publish", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, bulkActionInput);
  const results = await bulkSetPublication(staff, {
    productIds: body.productIds,
    state: body.action === "PUBLISH" ? "PUBLISHED" : "ARCHIVED",
    reason: body.reason,
  }, key, ctx.requestId);
  return jsonResponse({ results }, { requestId: ctx.requestId });
});
