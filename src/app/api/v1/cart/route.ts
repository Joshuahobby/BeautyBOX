import type { NextRequest } from "next/server";
import { jsonResponse, withApi } from "@/server/http/api";
import { guestFrom } from "@/server/http/session";
import { getCartView } from "@/modules/cart/cart";

export const dynamic = "force-dynamic";

export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  const session = await guestFrom(request);
  return jsonResponse(await getCartView(session), { requestId: ctx.requestId });
});
