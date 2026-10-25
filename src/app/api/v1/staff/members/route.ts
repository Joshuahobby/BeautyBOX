import type { NextRequest } from "next/server";
import { jsonResponse, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { pageQuery } from "@/server/http/staff-schemas";
import { listMembers } from "@/modules/staff/members";

export const dynamic = "force-dynamic";

export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  await staffFrom(request, "staff.manage", ctx.requestId);
  const page = pageQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
  return jsonResponse(await listMembers(page), { requestId: ctx.requestId });
});
