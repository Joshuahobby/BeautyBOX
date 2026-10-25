import { NextResponse, type NextRequest } from "next/server";
import { clientAddress, withApi } from "@/server/http/api";
import { afterResponse } from "@/server/http/after";
import { DomainError } from "@/modules/shared/errors";
import { serverEnv } from "@/server/env";
import { ingestProviderCallback } from "@/modules/payments/handlers";
import { runDueJobs } from "@/modules/jobs/worker";

// Signed provider callback. Exempt from browser CSRF checks only, never from signature
// verification. The raw bytes are verified exactly as received; the event is stored
// durably before the acknowledgement; application happens through an authoritative
// status lookup in the worker.
export const dynamic = "force-dynamic";

const MAX_CALLBACK_BYTES = 64 * 1024;

export const POST = withApi(async (request: NextRequest) => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_CALLBACK_BYTES) throw new DomainError("VALIDATION_ERROR", "Callback body too large.", { httpStatus: 413 });
  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length > MAX_CALLBACK_BYTES) throw new DomainError("VALIDATION_ERROR", "Callback body too large.", { httpStatus: 413 });
  // The signed request target must be the public URL the provider called, not an
  // internal proxy URL: rebuild it from the configured origin.
  const url = new URL(request.nextUrl.pathname + request.nextUrl.search, serverEnv().APP_ORIGIN).toString();
  await ingestProviderCallback({ rawBody, headers: request.headers, method: request.method, url }, { clientAddress: clientAddress(request) });
  // A nudge only: the event is already stored and the scheduled worker picks it up regardless.
  afterResponse(() => runDueJobs({ batchSize: 5, maxRuntimeMs: 10_000 }));
  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
});
