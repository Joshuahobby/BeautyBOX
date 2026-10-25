import type { NextRequest } from "next/server";
import { jsonResponse, withApi } from "@/server/http/api";
import { productListQuery } from "@/server/http/schemas";
import { listProducts } from "@/modules/catalog/catalog";
import { DomainError } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  const parsed = productListQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Invalid search or filter.", { httpStatus: 400 });
  const page = await listProducts(parsed.data);
  return jsonResponse({ items: page.items, nextCursor: page.nextCursor, total: page.total }, { requestId: ctx.requestId, cache: "public-short" });
});
