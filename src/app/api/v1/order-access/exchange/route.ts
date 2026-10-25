import type { NextRequest } from "next/server";
import { assertSameOrigin, clientAddress, jsonResponse, readJson, withApi } from "@/server/http/api";
import { orderTokenExchangeInput } from "@/server/http/schemas";
import { rateLimit } from "@/server/http/rate-limit";
import { setOrderCookie, viewerFrom } from "@/server/http/session";
import { exchangePrivateLink } from "@/modules/orders/private-links";
import { DomainError } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract exchangeOrderToken. The token arrives in the body (taken from the URL
// fragment by /order-access); bodies are never logged. Same answer for unknown, used
// and revoked tokens; an expired genuine token gets the "expired" recovery copy.
export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  await rateLimit("orderLinkExchange", clientAddress(request));
  const { token } = await readJson(request, orderTokenExchangeInput);
  const result = await exchangePrivateLink(token, await viewerFrom(request));
  if (result.kind === "EXPIRED") {
    throw new DomainError("NOT_FOUND", "This order link has expired. Contact support for help accessing your order.");
  }
  if (result.kind === "INVALID") {
    throw new DomainError("NOT_FOUND", "This order link is not valid or has already been used. Contact support for help accessing your order.");
  }
  const response = jsonResponse({ orderId: result.orderId, expiresAt: result.expiresAt.toISOString() }, { requestId: ctx.requestId });
  if (result.session) setOrderCookie(response, result.orderId, result.session.token, result.session.expiresAt);
  return response;
});
