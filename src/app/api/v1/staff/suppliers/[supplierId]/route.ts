import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { supplierEditInput } from "@/server/http/staff-schemas";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { editSupplier } from "@/modules/suppliers/suppliers";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract editSupplier (ADMIN): no vendor access or payout account; agreement changes
// never rewrite prior obligations.
export const PATCH = withApi<{ supplierId: string }>(async (request: NextRequest, { supplierId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(supplierId).success) throw notFound();
  const staff = await staffFrom(request, "suppliers.write", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, supplierEditInput);
  return jsonResponse(await editSupplier(staff, supplierId, body, key, ctx.requestId), { requestId: ctx.requestId });
});
