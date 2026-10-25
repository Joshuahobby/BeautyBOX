import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, clientAddress, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { afterResponse } from "@/server/http/after";
import { payRequestInput } from "@/server/http/schemas";
import { guestFrom, viewerFrom } from "@/server/http/session";
import { rateLimit } from "@/server/http/rate-limit";
import { startPayment } from "@/modules/payments/start-payment";
import { getPaymentAttemptView } from "@/modules/orders/customer-views";
import { runDueJobs } from "@/modules/jobs/worker";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const POST = withApi<{ checkoutId: string }>(async (request: NextRequest, { checkoutId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(checkoutId).success) throw notFound();
  const session = await guestFrom(request);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, payRequestInput);
  await rateLimit("paymentSession", session.id);
  await rateLimit("paymentAddress", clientAddress(request));

  const { attemptId, replayed } = await startPayment(session, checkoutId, body, key, ctx.requestId);
  // The intent is durable; prompt the provider right after responding. If this
  // process dies, the scheduled worker picks the same job up (never a new deposit).
  if (!replayed) afterResponse(() => runDueJobs({ batchSize: 5, maxRuntimeMs: 10_000 }));
  const attempt = await getPaymentAttemptView(attemptId, await viewerFrom(request));
  const response = jsonResponse(attempt, { status: 202, requestId: ctx.requestId });
  response.headers.set("Location", attempt.statusUrl);
  return response;
});
