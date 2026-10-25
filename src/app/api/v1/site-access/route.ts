import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, clientAddress, jsonResponse, readJson, withApi } from "@/server/http/api";
import { rateLimit } from "@/server/http/rate-limit";
import { serverEnv } from "@/server/env";
import { accessCookieValue, safeNextPath, SITE_ACCESS_COOKIE, SITE_ACCESS_MAX_AGE_SECONDS, verifyAccessCode } from "@/server/site-gate";
import { DomainError } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

const input = z.strictObject({ code: z.string().min(1).max(200), next: z.string().max(512).optional() });

// Pre-launch access code (DR-044). Attempts are rate-limited per address; a correct code sets
// an HttpOnly cookie derived from the code's verifier, so changing the code signs everyone out.
export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  assertSameOrigin(request);
  const env = serverEnv();
  await rateLimit("siteAccess", clientAddress(request));
  const body = await readJson(request, input);
  if (env.SITE_GATE !== "on" || !env.SITE_ACCESS_CODE_HASH) {
    return jsonResponse({ next: safeNextPath(body.next) }, { requestId: ctx.requestId });
  }
  if (!(await verifyAccessCode(body.code, env.SITE_ACCESS_CODE_HASH))) {
    throw new DomainError("UNAUTHORIZED", "That access code is not right.", { fieldErrors: [{ field: "code", message: "That access code is not right." }] });
  }
  const response = jsonResponse({ next: safeNextPath(body.next) }, { requestId: ctx.requestId });
  response.cookies.set(SITE_ACCESS_COOKIE, accessCookieValue(env.SITE_ACCESS_CODE_HASH, env.TOKEN_HASH_SECRET), {
    httpOnly: true,
    secure: env.APP_ORIGIN.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SITE_ACCESS_MAX_AGE_SECONDS,
  });
  return response;
});
