import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { setStaffRoleInput } from "@/server/http/staff-schemas";
import { setStaffRole } from "@/modules/staff/members";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const PATCH = withApi<{ memberId: string }>(async (request: NextRequest, { memberId }, ctx) => {
  assertSameOrigin(request);
  if (!z.uuid().safeParse(memberId).success) throw notFound();
  const staff = await staffFrom(request, "staff.manage", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, setStaffRoleInput);
  return jsonResponse(await setStaffRole(staff, memberId, body, key, ctx.requestId), { requestId: ctx.requestId });
});
