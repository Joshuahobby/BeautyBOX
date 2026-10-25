import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { refundDecisionInput } from "@/server/http/staff-schemas";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { decideRefund } from "@/modules/refunds/refunds";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract decideRefund: approval reserves budget under the receipt lock and queues the
// refund with a fixed provider id. It is not proof that money moved.
export const POST = withApi<{ refundId: string }>(async (request: NextRequest, { refundId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(refundId).success) throw notFound();
  const staff = await staffFrom(request, "refunds.approve", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, refundDecisionInput);
  return jsonResponse(await decideRefund(staff, refundId, body, key, ctx.requestId), { requestId: ctx.requestId });
});
