import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, clientAddress, jsonResponse, withApi } from "@/server/http/api";
import { rateLimit } from "@/server/http/rate-limit";
import { viewerFrom } from "@/server/http/session";
import { issueLinkForOwner } from "@/modules/orders/private-links";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract addition CC-08: the browser session that placed a paid order can create a
// one-time private link to open it on another device. Shown once; only its hash is kept.
export const POST = withApi<{ orderId: string }>(async (request: NextRequest, { orderId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(orderId).success) throw notFound();
  await rateLimit("orderAction", clientAddress(request));
  return jsonResponse(await issueLinkForOwner(await viewerFrom(request), orderId), { status: 201, requestId: ctx.requestId });
});
