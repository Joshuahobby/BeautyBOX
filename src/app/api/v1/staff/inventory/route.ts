import type { NextRequest } from "next/server";
import { jsonResponse, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { pageQuery } from "@/server/http/staff-schemas";
import { listStockLots } from "@/modules/inventory/admin";

export const dynamic = "force-dynamic";

export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  await staffFrom(request, "catalog.read", ctx.requestId);
  const page = pageQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
  const sku = request.nextUrl.searchParams.get("sku")?.slice(0, 64) ?? undefined;
  return jsonResponse(await listStockLots({ ...page, sku }), { requestId: ctx.requestId });
});
