import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonResponse, withApi } from "@/server/http/api";
import { viewerFrom } from "@/server/http/session";
import { getCustomerOrderView } from "@/modules/orders/customer-views";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const GET = withApi<{ orderId: string }>(async (request: NextRequest, { orderId }, ctx) => {
  if (!z.uuid().safeParse(orderId).success) throw notFound();
  return jsonResponse(await getCustomerOrderView(orderId, await viewerFrom(request)), { requestId: ctx.requestId });
});
