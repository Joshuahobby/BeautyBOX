import type { NextRequest } from "next/server";
import { jsonResponse, withApi } from "@/server/http/api";
import { guestFrom } from "@/server/http/session";
import { rateLimit } from "@/server/http/rate-limit";
import { placesAdapter } from "@/adapters/registry";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

export const GET = withApi<{ placeId: string }>(
  async (request: NextRequest, { placeId }, ctx) => {
    const session = await guestFrom(request);
    await rateLimit("quote", `places:${session.id}`);
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(placeId)) throw notFound();
    const place = await placesAdapter().resolve(placeId);
    if (!place) throw notFound();
    return jsonResponse(place, { requestId: ctx.requestId });
  },
);
