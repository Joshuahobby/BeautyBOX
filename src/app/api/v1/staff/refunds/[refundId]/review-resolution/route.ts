import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { refundReviewInput } from "@/server/http/staff-schemas";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { resolveRefundReview } from "@/modules/refunds/refunds";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract resolveRefundReview (CC-18, DR-043): finance records what the provider's dashboard
// shows for a refund flagged NEEDS_REVIEW. It never sends anything to the provider.
export const POST = withApi<{ refundId: string }>(async (request: NextRequest, { refundId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(refundId).success) throw notFound();
  const staff = await staffFrom(request, "refunds.approve", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, refundReviewInput);
  return jsonResponse(await resolveRefundReview(staff, refundId, body, key, ctx.requestId), { requestId: ctx.requestId });
});
