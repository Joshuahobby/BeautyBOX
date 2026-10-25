import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { reasonInput } from "@/server/http/staff-schemas";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { reconcileRefund } from "@/modules/refunds/refunds";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract reconcileRefund: re-checks the SAME provider refund id; never resubmits.
export const POST = withApi<{ refundId: string }>(async (request: NextRequest, { refundId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(refundId).success) throw notFound();
  const staff = await staffFrom(request, "payments.reconcile", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const { reason } = await readJson(request, reasonInput);
  return jsonResponse(await reconcileRefund(staff, refundId, reason, key, ctx.requestId), { status: 202, requestId: ctx.requestId });
});
