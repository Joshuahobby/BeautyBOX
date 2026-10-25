import type { NextRequest } from "next/server";
import { jsonResponse, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { staffOrderQuery } from "@/server/http/staff-schemas";
import { listStaffOrders } from "@/modules/orders/staff-views";
import { DomainError } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract listStaffOrders. Items are summaries (CC-11): no contact data in bulk lists.
export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  await staffFrom(request, "orders.read", ctx.requestId);
  const parsed = staffOrderQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Check the filters.");
  const q = parsed.data;
  return jsonResponse(
    await listStaffOrders({
      state: q.state,
      reference: q.reference || undefined,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      limit: q.limit,
      cursor: q.cursor ?? null,
    }),
    { requestId: ctx.requestId },
  );
});
