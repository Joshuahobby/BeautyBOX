import { jsonResponse, withApi } from "@/server/http/api";
import { enabledPaymentMethods } from "@/modules/payments/methods";

export const dynamic = "force-dynamic";

export const GET = withApi(async (_request, _params, ctx) => {
  return jsonResponse(await enabledPaymentMethods(), { requestId: ctx.requestId });
});
