import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { settlementInput } from "@/server/http/staff-schemas";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { recordSettlement } from "@/modules/suppliers/suppliers";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract recordManualSettlement (ADMIN, FINANCE): evidence record only; it never
// initiates a payment or provider payout.
export const POST = withApi<{ obligationId: string }>(async (request: NextRequest, { obligationId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(obligationId).success) throw notFound();
  const staff = await staffFrom(request, "suppliers.settle", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, settlementInput);
  return jsonResponse(await recordSettlement(staff, obligationId, body, key, ctx.requestId), { requestId: ctx.requestId });
});
