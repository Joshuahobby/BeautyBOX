import { jsonResponse, withApi } from "@/server/http/api";
import { listCategories } from "@/modules/catalog/catalog";

export const dynamic = "force-dynamic";

export const GET = withApi(async (_request, _params, ctx) => {
  const items = await listCategories();
  return jsonResponse({ items, nextCursor: null }, { requestId: ctx.requestId, cache: "public-short" });
});
