import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonResponse, withApi } from "@/server/http/api";
import { viewerFrom } from "@/server/http/session";
import { getGuestOperation } from "@/modules/operations/operations";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const GET = withApi<{ operationId: string }>(async (request: NextRequest, { operationId }, ctx) => {
  if (!z.uuid().safeParse(operationId).success) throw notFound();
  return jsonResponse(await getGuestOperation(await viewerFrom(request), operationId), { requestId: ctx.requestId });
});
