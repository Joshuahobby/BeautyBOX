import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonResponse, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { getStaffOrder } from "@/modules/orders/staff-views";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const GET = withApi<{ orderId: string }>(async (request: NextRequest, { orderId }, ctx) => {
  if (!z.uuid().safeParse(orderId).success) throw notFound();
  const staff = await staffFrom(request, "orders.read", ctx.requestId);
  return jsonResponse(await getStaffOrder(staff, orderId), { requestId: ctx.requestId });
});
