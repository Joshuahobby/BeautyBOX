// Minimal structured logger with redaction (handoff Security-and-Operations
// "Observability"): operation ids, state transitions and error codes only. Phone
// numbers, tokens, coordinates, callback bodies and secrets never reach logs.

const REDACT_KEYS = /phone|msisdn|token|secret|password|authorization|cookie|lat|lng|coordinate|body|payload|email|name/i;

type Level = "debug" | "info" | "warn" | "error";

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACT_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1)]),
    );
  }
  return value;
}

export function logEvent(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (process.env.APP_ENV === "test" && level !== "error") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(redact(fields) as object) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}
