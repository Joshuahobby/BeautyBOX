import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, clientAddress, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { cancellationRequestInput } from "@/server/http/schemas";
import { rateLimit } from "@/server/http/rate-limit";
import { viewerFrom } from "@/server/http/session";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { requestCancellation } from "@/modules/operations/operations";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract requestCancellation: records a request for staff; never cancels by itself.
export const POST = withApi<{ orderId: string }>(async (request: NextRequest, { orderId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(orderId).success) throw notFound();
  await rateLimit("orderAction", clientAddress(request));
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, cancellationRequestInput);
  const op = await requestCancellation(await viewerFrom(request), orderId, body, key, ctx.requestId);
  return jsonResponse(op, { status: 202, requestId: ctx.requestId });
});
