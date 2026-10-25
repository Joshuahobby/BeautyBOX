import { NextResponse, type NextRequest } from "next/server";
import { withApi } from "@/server/http/api";
import { staffFrom } from "@/server/http/staff";
import { readProductMedia } from "@/modules/media/uploads";
import { PUBLIC_PHOTO_CACHE_SECONDS } from "@/adapters/storage/types";
import { notFound } from "@/modules/shared/errors";

export const dynamic = "force-dynamic";

// Product photos through the app: the storefront's images with local storage, and staff
// previews with any storage (DR-041; the storefront links to the public bucket when
// hosted). Approved photos are public and immutable; a photo still awaiting review is
// shown only to signed-in staff; a rejected one to nobody.
export const GET = withApi<{ key: string[] }>(async (request: NextRequest, { key }, ctx) => {
  const found = await readProductMedia(key.join("/"));
  if (!found) throw notFound();
  if (!found.approved) await staffFrom(request, "catalog.read", ctx.requestId);
  return new NextResponse(new Uint8Array(found.bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(found.bytes.length),
      "X-Content-Type-Options": "nosniff",
      // Same lifetime as the public bucket, so removing a photo takes effect equally fast.
      "Cache-Control": found.approved ? `public, max-age=${PUBLIC_PHOTO_CACHE_SECONDS}` : "private, no-store",
    },
  });
});
