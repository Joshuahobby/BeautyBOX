import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  assertSameOrigin,
  idempotencyKeyFrom,
  jsonResponse,
  readJson,
  withApi,
} from "@/server/http/api";
import {
  removeCartLineInput,
  replaceCartLineInput,
} from "@/server/http/schemas";
import { guestFrom } from "@/server/http/session";
import { rateLimit } from "@/server/http/rate-limit";
import { removeCartLine, replaceCartLine } from "@/modules/cart/cart";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const DELETE = withApi<{ variantId: string }>(
  async (request: NextRequest, { variantId }, ctx) => {
    assertSameOrigin(request);
    if (!z.uuid().safeParse(variantId).success) throw notFound();
    const session = await guestFrom(request);
    const key = validateIdempotencyKey(idempotencyKeyFrom(request));
    const body = await readJson(request, removeCartLineInput);
    await rateLimit("cart", session.id);
    return jsonResponse(
      await removeCartLine(
        session,
        { variantId, expectedVersion: body.expectedVersion },
        key,
      ),
      {
        requestId: ctx.requestId,
      },
    );
  },
);

export const PATCH = withApi<{ variantId: string }>(
  async (request: NextRequest, { variantId }, ctx) => {
    assertSameOrigin(request);
    if (!z.uuid().safeParse(variantId).success) throw notFound();
    const session = await guestFrom(request);
    const key = validateIdempotencyKey(idempotencyKeyFrom(request));
    const body = await readJson(request, replaceCartLineInput);
    await rateLimit("cart", session.id);
    return jsonResponse(
      await replaceCartLine(session, { variantId, ...body }, key),
      { requestId: ctx.requestId },
    );
  },
);
