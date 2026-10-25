import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { accessReissueInput } from "@/server/http/staff-schemas";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { reissueOrderAccess } from "@/modules/orders/access-reissue";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract reissueOrderAccess: the new link goes to the order's contact number by SMS;
// the response never contains the token.
export const POST = withApi<{ orderId: string }>(async (request: NextRequest, { orderId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(orderId).success) throw notFound();
  const staff = await staffFrom(request, "access.reissue", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, accessReissueInput);
  return jsonResponse(await reissueOrderAccess(staff, orderId, body, key, ctx.requestId), { status: 202, requestId: ctx.requestId });
});
