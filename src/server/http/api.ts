import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { serverEnv } from "@/server/env";
import { DomainError, isDomainError } from "@/modules/shared/errors";
import { logEvent } from "@/server/log";

// Application HTTP boundary (/api/v1). Every response carries a request id; private
// responses are no-store; errors use the contract's Error shape with controlled copy
// (never provider text or stack traces).

export type ApiContext = { requestId: string };

const MAX_BODY_BYTES = 16 * 1024;

export function jsonResponse(
  body: unknown,
  init: {
    status?: number;
    requestId: string;
    cache?: "no-store" | "public-short";
  },
) {
  const res = NextResponse.json(body, { status: init.status ?? 200 });
  res.headers.set("X-Request-Id", init.requestId);
  res.headers.set(
    "Cache-Control",
    init.cache === "public-short"
      ? "public, max-age=30, stale-while-revalidate=60"
      : "private, no-store, max-age=0",
  );
  return res;
}

export function errorResponse(error: DomainError, requestId: string) {
  const res = jsonResponse(
    {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.fieldErrors && error.fieldErrors.length > 0
        ? { fieldErrors: error.fieldErrors }
        : {}),
    },
    { status: error.httpStatus, requestId },
  );
  if (error.retryAfterSeconds)
    res.headers.set("Retry-After", String(error.retryAfterSeconds));
  return res;
}

export function withApi<
  P extends Record<string, string | string[]> = Record<string, never>,
>(
  handler: (
    request: NextRequest,
    params: P,
    ctx: ApiContext,
  ) => Promise<NextResponse>,
) {
  return async (
    request: NextRequest,
    route: { params: Promise<P> },
  ): Promise<NextResponse> => {
    const requestId = randomUUID();
    try {
      const params = await route.params;
      const response = await handler(request, params, { requestId });
      response.headers.set("X-Request-Id", requestId);
      return response;
    } catch (error) {
      if (isDomainError(error)) return errorResponse(error, requestId);
      logEvent("error", "api_unhandled", {
        requestId,
        route: request.nextUrl.pathname.replace(/[0-9a-f-]{36}/gi, ":id"),
        error:
          error instanceof Error
            ? `${error.name}: ${error.message.slice(0, 200)}`
            : "unknown",
      });
      return errorResponse(
        new DomainError(
          "INTERNAL_ERROR",
          "Something went wrong. Please try again.",
        ),
        requestId,
      );
    }
  };
}

/** Parse a JSON body strictly against a schema (unknown fields rejected). */
export async function readJson<T extends z.ZodType>(
  request: NextRequest,
  schema: T,
  options: { maxBytes?: number } = {},
): Promise<z.infer<T>> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new DomainError("VALIDATION_ERROR", "Send a JSON request body.", {
      httpStatus: 400,
    });
  }
  const limit = options.maxBytes ?? MAX_BODY_BYTES;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) {
          void reader.cancel().catch(() => {});
          throw new DomainError(
            "VALIDATION_ERROR",
            "Request body is too large.",
            { httpStatus: 400 },
          );
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Request body is not valid JSON.",
      { httpStatus: 400 },
    );
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Check the highlighted details.",
      {
        httpStatus: 422,
        fieldErrors: parsed.error.issues.slice(0, 20).map((i) => ({
          field: i.path.join(".") || "body",
          message:
            i.code === "unrecognized_keys"
              ? "Unknown field."
              : "Invalid value.",
        })),
      },
    );
  }
  return parsed.data;
}

/**
 * Same-origin defence for cookie-authenticated mutations (CSRF). Browsers send
 * Origin on cross-site POST/PATCH/DELETE; we require it to match the configured
 * application origin, or Sec-Fetch-Site to say same-origin. Signed provider
 * callbacks and the authenticated worker endpoint do not use this check.
 */
export function assertSameOrigin(request: NextRequest): void {
  const expected = new URL(serverEnv().APP_ORIGIN).origin;
  const origin = request.headers.get("origin");
  if (origin) {
    if (origin !== expected)
      throw new DomainError("FORBIDDEN", "Request origin is not allowed.");
    return;
  }
  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin") return;
  throw new DomainError("FORBIDDEN", "Request origin is not allowed.");
}

export function idempotencyKeyFrom(request: NextRequest): string | null {
  return request.headers.get("idempotency-key");
}

export function clientAddress(request: NextRequest): string {
  // Behind the hosting proxy the first X-Forwarded-For entry is the client. Used only
  // as a hashed rate-limit key, never stored raw.
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  );
}
