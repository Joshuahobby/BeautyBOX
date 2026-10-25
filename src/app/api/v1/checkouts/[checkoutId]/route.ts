import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { checkoutPatchInput } from "@/server/http/schemas";
import { guestFrom } from "@/server/http/session";
import { getCheckoutView, updateCheckout } from "@/modules/checkout/checkout";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

const id = (value: string) => {
  if (!z.uuid().safeParse(value).success) throw notFound();
  return value;
};

export const GET = withApi<{ checkoutId: string }>(async (request: NextRequest, { checkoutId }, ctx) => {
  const session = await guestFrom(request);
  return jsonResponse(await getCheckoutView(session, id(checkoutId)), { requestId: ctx.requestId });
});

export const PATCH = withApi<{ checkoutId: string }>(async (request: NextRequest, { checkoutId }, ctx) => {
  assertSameOrigin(request);
  const session = await guestFrom(request);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, checkoutPatchInput);
  return jsonResponse(await updateCheckout(session, id(checkoutId), body, key), { requestId: ctx.requestId });
});
