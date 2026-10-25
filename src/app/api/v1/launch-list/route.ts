import type { NextRequest } from "next/server";
import { z } from "zod";
import { clientAddress, jsonResponse, readJson, withApi } from "@/server/http/api";
import { serverEnv } from "@/server/env";
import { normalizeHost } from "@/server/site-gate";
import { joinLaunchList } from "@/modules/launch/launch-list";
import { DomainError } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

const input = z.strictObject({ email: z.string().max(320).nullable().optional(), phone: z.string().max(40).nullable().optional(), consent: z.boolean() });

/** The shop's origin, or a holding host (the main domain before launch), on the same scheme. */
function assertLaunchOrigin(request: NextRequest): string {
  const env = serverEnv();
  const app = new URL(env.APP_ORIGIN);
  const header = request.headers.get("origin");
  let origin: URL | null = null;
  try {
    origin = header ? new URL(header) : null;
  } catch {
    origin = null;
  }
  const host = origin ? normalizeHost(origin.hostname) : "";
  const shop = origin !== null && origin.protocol === app.protocol && origin.port === app.port && host === normalizeHost(app.hostname);
  // A holding host is served by the same deployment, so on the shop's scheme and port.
  const holding = origin !== null && origin.protocol === app.protocol && origin.port === app.port && (env.HOLDING_HOSTS?.split(",") ?? []).includes(host);
  if (!shop && !holding) throw new DomainError("FORBIDDEN", "Request origin is not allowed.");
  return host;
}

// Launch list sign-up (DR-045): an e-mail address and/or a Rwanda mobile number. Same answer
// whether or not the person was already on the list, so the form cannot reveal who signed up.
export const POST = withApi(async (request: NextRequest, _params, ctx) => {
  const host = assertLaunchOrigin(request);
  const body = await readJson(request, input);
  await joinLaunchList(body, { client: clientAddress(request), host });
  return jsonResponse({ status: "RECEIVED" }, { status: 202, requestId: ctx.requestId });
});
