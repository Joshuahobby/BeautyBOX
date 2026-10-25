import type { NextRequest } from "next/server";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { createCheckoutInput } from "@/server/http/schemas";
import { guestFrom } from "@/server/http/session";
import { createOrReuseCheckout } from "@/modules/checkout/checkout";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";

export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  const session = await guestFrom(request);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, createCheckoutInput);
  return jsonResponse(await createOrReuseCheckout(session, body, key), { status: 201, requestId: ctx.requestId });
});
