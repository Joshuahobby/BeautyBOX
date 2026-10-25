import type { NextRequest } from "next/server";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { supplierCreateInput, uuidPageQuery } from "@/server/http/staff-schemas";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { createSupplier, listSuppliers } from "@/modules/suppliers/suppliers";
import { DomainError } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Contract listSuppliers (ADMIN, FINANCE, OPERATIONS) / createSupplier (ADMIN).
export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  await staffFrom(request, "suppliers.read", ctx.requestId);
  const parsed = uuidPageQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Check the page parameters.");
  return jsonResponse(await listSuppliers({ limit: parsed.data.limit, cursor: parsed.data.cursor ?? null }), { requestId: ctx.requestId });
});

export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  const staff = await staffFrom(request, "suppliers.write", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, supplierCreateInput);
  return jsonResponse(await createSupplier(staff, body, key, ctx.requestId), { status: 201, requestId: ctx.requestId });
});
