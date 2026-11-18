"use client";

// Browser client for the application API (/api/v1). Mutations always carry a fresh
// Idempotency-Key unless the caller supplies one to retry the same intent, and the
// server's controlled error copy is surfaced as-is (never raw provider text).

export type FieldError = { field: string; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: FieldError[] = [],
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const newIdempotencyKey = () => `web-${crypto.randomUUID()}`;

/** A gateway page or an in-flight idempotent intent never proves rejection. */
export const isDefiniteRejection = (error: unknown): error is ApiError =>
  error instanceof ApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  error.code !== "UNCERTAIN" &&
  error.code !== "IDEMPOTENCY_CONFLICT";

type Options = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = options.idempotencyKey ?? newIdempotencyKey();
  }
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(options.body ?? {}),
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(
      0,
      "NETWORK",
      "We couldn't reach BeautyBOX. Check your connection and try again.",
    );
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    // A proxy or gateway answered with a non-JSON page (for example a 502/504). The
    // request may or may not have been applied, so callers must treat it as uncertain.
    throw new ApiError(
      response.ok ? 0 : response.status,
      "UNCERTAIN",
      "We could not confirm whether that worked. Check the record before trying again.",
    );
  }
  if (!response.ok) {
    const e = (data ?? {}) as {
      code?: string;
      message?: string;
      fieldErrors?: FieldError[];
      requestId?: string;
    };
    throw new ApiError(
      response.status,
      e.code ?? "INTERNAL_ERROR",
      e.message ?? "Something went wrong. Please try again.",
      e.fieldErrors ?? [],
      e.requestId ?? null,
    );
  }
  return data as T;
}

let sessionReady: Promise<void> | null = null;

/** Ensures the opaque guest session cookie exists (POST /session is idempotent per browser). */
export function ensureGuestSession(): Promise<void> {
  sessionReady ??= api<{ expiresAt: string }>("/session", { method: "POST" })
    .then(() => undefined)
    .catch((error) => {
      sessionReady = null;
      throw error;
    });
  return sessionReady;
}
