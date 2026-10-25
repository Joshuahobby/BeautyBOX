import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonResponse, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { getStaffOperation } from "@/modules/operations/operations";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const GET = withApi<{ operationId: string }>(async (request: NextRequest, { operationId }, ctx) => {
  if (!z.uuid().safeParse(operationId).success) throw notFound();
  await staffFrom(request, "orders.read", ctx.requestId);
  return jsonResponse(await getStaffOperation(operationId), { requestId: ctx.requestId });
});
