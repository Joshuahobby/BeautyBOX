import type { NextRequest } from "next/server";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { cartLineInput } from "@/server/http/schemas";
import { guestFrom } from "@/server/http/session";
import { rateLimit } from "@/server/http/rate-limit";
import { setCartLine } from "@/modules/cart/cart";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";

export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  const session = await guestFrom(request);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, cartLineInput);
  await rateLimit("cart", session.id);
  return jsonResponse(await setCartLine(session, body, key), { requestId: ctx.requestId });
});
