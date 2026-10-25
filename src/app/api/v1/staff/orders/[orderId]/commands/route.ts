import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { orderCommandInput } from "@/server/http/staff-schemas";
import { applyOrderCommand, capabilityFor } from "@/modules/fulfillment/commands";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { getStaffOrder } from "@/modules/orders/staff-views";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract commandOrder: state-guarded, versioned, audited and atomic with stock.
// Authentication first; then the command-specific capability (fulfilment or cancel),
// whose denial is audited like any other (T16). The command re-checks it too.
export const POST = withApi<{ orderId: string }>(async (request: NextRequest, { orderId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(orderId).success) throw notFound();
  await staffFrom(request, "orders.read", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const command = await readJson(request, orderCommandInput);
  const staff = await staffFrom(request, capabilityFor(command.action), ctx.requestId);
  await applyOrderCommand(staff, orderId, command, key, ctx.requestId);
  return jsonResponse(await getStaffOrder(staff, orderId), { requestId: ctx.requestId });
});
