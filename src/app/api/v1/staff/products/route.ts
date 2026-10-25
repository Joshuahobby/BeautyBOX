import type { NextRequest } from "next/server";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { pageQuery, productDraftInput } from "@/server/http/staff-schemas";
import { createProductDraft, listStaffProducts } from "@/modules/catalog/admin";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";

export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  await staffFrom(request, "catalog.read", ctx.requestId);
  const page = pageQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
  return jsonResponse(await listStaffProducts(page), { requestId: ctx.requestId });
});

export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  const staff = await staffFrom(request, "catalog.write", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, productDraftInput);
  return jsonResponse(await createProductDraft(staff, body, key, ctx.requestId), { status: 201, requestId: ctx.requestId });
});
