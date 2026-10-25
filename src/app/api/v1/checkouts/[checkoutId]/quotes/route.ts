import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { quoteInput } from "@/server/http/schemas";
import { guestFrom } from "@/server/http/session";
import { rateLimit } from "@/server/http/rate-limit";
import { requestQuote } from "@/modules/delivery/quote";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const POST = withApi<{ checkoutId: string }>(async (request: NextRequest, { checkoutId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(checkoutId).success) throw notFound();
  const session = await guestFrom(request);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, quoteInput);
  await rateLimit("quote", session.id);
  return jsonResponse(await requestQuote(session, checkoutId, body, key), { requestId: ctx.requestId });
});
