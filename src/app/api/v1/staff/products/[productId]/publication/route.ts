import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { publicationInput } from "@/server/http/staff-schemas";
import { setPublication } from "@/modules/catalog/admin";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const POST = withApi<{ productId: string }>(async (request: NextRequest, { productId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(productId).success) throw notFound();
  const staff = await staffFrom(request, "catalog.publish", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, publicationInput);
  return jsonResponse(await setPublication(staff, productId, body, key, ctx.requestId), { requestId: ctx.requestId });
});
