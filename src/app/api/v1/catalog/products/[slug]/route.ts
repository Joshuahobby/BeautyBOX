import { jsonResponse, withApi } from "@/server/http/api";
import { getProductBySlug } from "@/modules/catalog/catalog";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const GET = withApi<{ slug: string }>(async (_request, { slug }, ctx) => {
  const product = await getProductBySlug(slug.slice(0, 120));
  if (!product) throw notFound();
  return jsonResponse(product, { requestId: ctx.requestId, cache: "public-short" });
});
