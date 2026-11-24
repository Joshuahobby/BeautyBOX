import "server-only";
import type { EmailAdapter, EmailMessage, EmailSendResult } from "./types";

// Resend's e-mail API (DR-059): one fixed host, the key only in the Authorization header,
// one recipient per request, bounded response, timeout and no adapter retries. The
// outbox decides retries; ambiguous answers are UNKNOWN and never blindly resent.
export const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_RESPONSE_BYTES = 64 * 1024;
// Answers that mean the message was definitely not accepted.
const REFUSED = new Map([
  [400, "REQUEST_REJECTED"],
  [401, "UNAUTHORIZED"],
  [403, "FORBIDDEN"],
  [404, "NOT_FOUND"],
  [405, "REQUEST_REJECTED"],
  [422, "REQUEST_REJECTED"],
  [429, "RATE_LIMITED"],
]);

export type ResendConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
};

async function cappedText(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks).toString("utf8");
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export class ResendEmailAdapter implements EmailAdapter {
  readonly provider = "RESEND" as const;
  constructor(
    private readonly config: ResendConfig,
    private readonly transport: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async sendTransactional(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.config.apiKey || !this.config.from)
      return { kind: "FAILED", code: "EMAIL_CONFIGURATION" };
    if (!/^[^\s@]+@[^\s@]+$/.test(message.to) || !message.subject.trim())
      return { kind: "FAILED", code: "EMAIL_INPUT" };
    const body = {
      from: this.config.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(this.config.replyTo ? { reply_to: this.config.replyTo } : {}),
    };
    let response: Response;
    try {
      response = await this.transport(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      // Timeout or network error after the request may have left: possibly sent.
      return { kind: "UNKNOWN", reason: "EMAIL_NO_RESPONSE" };
    }
    // 409: this key was already used, so a message may already have gone out.
    if (response.status === 409) {
      void response.body?.cancel().catch(() => {});
      return { kind: "UNKNOWN", reason: "EMAIL_IDEMPOTENCY_CONFLICT" };
    }
    const refused = REFUSED.get(response.status);
    if (refused) {
      void response.body?.cancel().catch(() => {});
      return { kind: "FAILED", code: refused };
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return { kind: "UNKNOWN", reason: "EMAIL_HTTP_UNCERTAIN" };
    }
    try {
      const text = await cappedText(response);
      if (text === null)
        return { kind: "UNKNOWN", reason: "EMAIL_RESPONSE_TOO_LARGE" };
      const id = (JSON.parse(text) as { id?: unknown } | null)?.id;
      return {
        kind: "ACCEPTED",
        providerMessageId:
          typeof id === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(id)
            ? id
            : null,
      };
    } catch {
      // A 2xx means Resend accepted it; an unreadable body does not undo that, but the
      // id is unknown. Treat as accepted without an id rather than risk a duplicate.
      return { kind: "ACCEPTED", providerMessageId: null };
    }
  }
}
