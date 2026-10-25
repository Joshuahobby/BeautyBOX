import type { NextRequest } from "next/server";
import { jsonResponse, withApi } from "@/server/http/api";
import { guestFrom } from "@/server/http/session";
import { rateLimit } from "@/server/http/rate-limit";
import { placesAdapter } from "@/adapters/registry";
import { DomainError } from "@/modules/shared/errors";

// Contract addition CC-05: server-side place search for the destination step, so the
// browser never needs a route-service key. Results are suggestions only; the customer
// still confirms the exact pin.
export const dynamic = "force-dynamic";

export const GET = withApi(async (request: NextRequest, _params, ctx) => {
  const session = await guestFrom(request);
  await rateLimit("quote", `places:${session.id}`);
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return jsonResponse({ items: [] }, { requestId: ctx.requestId });
  const items = await placesAdapter().search(q);
  if (items === null) throw new DomainError("PROVIDER_UNAVAILABLE", "Place search is unavailable. You can still place the pin manually.");
  return jsonResponse({ items }, { requestId: ctx.requestId });
});
