import type { NextRequest } from "next/server";
import { jsonResponse, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { obligationQuery } from "@/server/http/staff-schemas";
import { listObligations } from "@/modules/suppliers/suppliers";
import { DomainError } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract listSupplierObligations (ADMIN, FINANCE): supplier costs are finance data.
export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  await staffFrom(request, "suppliers.settle", ctx.requestId);
  const parsed = obligationQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Check the filters.");
  const q = parsed.data;
  return jsonResponse(await listObligations({ limit: q.limit, cursor: q.cursor ?? null, supplierId: q.supplierId, state: q.state }), { requestId: ctx.requestId });
});
