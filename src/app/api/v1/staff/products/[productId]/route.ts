import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { replaceDraftInput } from "@/server/http/staff-schemas";
import { getStaffProduct, replaceProductDraft } from "@/modules/catalog/admin";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

const id = (v: string) => {
  if (!z.uuid().safeParse(v).success) throw notFound();
  return v;
};

export const GET = withApi<{ productId: string }>(async (request: NextRequest, { productId }, ctx) => {
  await staffFrom(request, "catalog.read", ctx.requestId);
  return jsonResponse(await getStaffProduct(id(productId)), { requestId: ctx.requestId });
});

export const PUT = withApi<{ productId: string }>(async (request: NextRequest, { productId }, ctx) => {
  assertSameOrigin(request);
  const staff = await staffFrom(request, "catalog.write", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, replaceDraftInput);
  return jsonResponse(await replaceProductDraft(staff, id(productId), body, key, ctx.requestId), { requestId: ctx.requestId });
});
