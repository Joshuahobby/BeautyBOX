import type { NextRequest } from "next/server";
import { jsonResponse, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { uuidPageQuery } from "@/server/http/staff-schemas";
import { listReceipts } from "@/modules/refunds/refunds";
import { DomainError } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  await staffFrom(request, "payments.read", ctx.requestId);
  const parsed = uuidPageQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Check the page parameters.");
  return jsonResponse(await listReceipts({ limit: parsed.data.limit, cursor: parsed.data.cursor ?? null }), { requestId: ctx.requestId });
});
