import type { NextRequest } from "next/server";
import { assertSameOrigin, idempotencyKeyFrom, jsonResponse, readJson, withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { settingsUpdateInput } from "@/server/http/staff-schemas";
import { validateIdempotencyKey } from "@/modules/idempotency/idempotency";
import { getSettings, updateSettings } from "@/modules/settings/admin";

export const dynamic = "force-dynamic";

// Contract getSettings / updateSettings (ADMIN; FINANCE may read). Every change is a new
// version; publicationBlocks are recomputed by the server and never accepted from input.
export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  const staff = await staffFrom(request, "settings.read", ctx.requestId);
  return jsonResponse(await getSettings(staff), { requestId: ctx.requestId });
});

export const PUT = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  const staff = await staffFrom(request, "settings.write", ctx.requestId);
  const key = validateIdempotencyKey(idempotencyKeyFrom(request));
  const body = await readJson(request, settingsUpdateInput);
  return jsonResponse(await updateSettings(staff, body, key, ctx.requestId), { requestId: ctx.requestId });
});
