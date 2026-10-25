import type { NextRequest } from "next/server";
import { jsonResponse, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { getMe } from "@/modules/staff/members";
import { capabilitiesOf } from "@/modules/staff/capabilities";

export const dynamic = "force-dynamic";

export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  const staff = await staffFrom(request, undefined, ctx.requestId);
  // Addition (CC-10): the capability list lets the UI hide actions the server would refuse anyway.
  return jsonResponse({ ...(await getMe(staff)), capabilities: capabilitiesOf(staff.role) }, { requestId: ctx.requestId });
});
