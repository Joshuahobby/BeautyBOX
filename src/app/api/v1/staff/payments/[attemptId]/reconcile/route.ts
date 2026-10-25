import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { reasonInput } from "@/server/http/staff-schemas";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { reconcilePayment } from "@/modules/payments/reconcile";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract reconcilePayment: looks up the EXISTING deposit; never creates a new one.
export const POST = withApi<{ attemptId: string }>(async (request: NextRequest, { attemptId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(attemptId).success) throw notFound();
  const staff = await staffFrom(request, "payments.reconcile", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const { reason } = await readJson(request, reasonInput);
  return jsonResponse(await reconcilePayment(staff, attemptId, reason, key, ctx.requestId), { status: 202, requestId: ctx.requestId });
});
