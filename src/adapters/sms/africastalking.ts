import "server-only";
import type { SmsAdapter, SmsSendResult } from "./types";

// Classic SMS API: fixed official hosts, form encoding, apiKey header. Provider
// acceptance is not handset delivery. No adapter retries or endpoint overrides.
export const AFRICASTALKING_ENDPOINTS = {
  sandbox: "https://api.sandbox.africastalking.com/version1/messaging",
  live: "https://api.africastalking.com/version1/messaging",
} as const;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REJECTED = new Map([
  [402, "INVALID_SENDER"],
  [403, "INVALID_RECIPIENT"],
  [404, "UNSUPPORTED_NUMBER"],
  [405, "INSUFFICIENT_BALANCE"],
  [406, "BLACKLISTED"],
  [407, "NO_ROUTE"],
  [409, "DO_NOT_DISTURB"],
  [502, "GATEWAY_REJECTED"],
]);
export type AfricasTalkingConfig = {
  sendEnabled?: boolean;
  mode: "sandbox" | "live";
  appEnv: string;
  username?: string;
  apiKey?: string;
  senderId?: string;
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

export class AfricasTalkingSmsAdapter implements SmsAdapter {
  readonly provider = "AFRICASTALKING" as const;
  constructor(
    private readonly config: AfricasTalkingConfig,
    private readonly transport: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async sendTransactional(input: {
    messageIntentId: string;
    recipientE164: string;
    text: string;
  }): Promise<SmsSendResult> {
    if (!this.config.sendEnabled)
      return { kind: "FAILED", code: "SMS_DISABLED" };
    const { mode, appEnv, username, apiKey, senderId } = this.config;
    if (
      (mode === "live" && appEnv !== "production") ||
      !username ||
      !apiKey ||
      !senderId ||
      (mode === "sandbox" && username !== "sandbox") ||
      (mode === "live" && username === "sandbox")
    )
      return { kind: "FAILED", code: "SMS_CONFIGURATION" };
    if (!/^\+[1-9]\d{7,14}$/.test(input.recipientE164) || !input.text.trim())
      return { kind: "FAILED", code: "SMS_INPUT" };
    const body = new URLSearchParams({
      username,
      to: input.recipientE164,
      from: senderId,
      message: input.text,
      bulkSMSMode: "1",
    });
    try {
      const response = await this.transport(AFRICASTALKING_ENDPOINTS[mode], {
        method: "POST",
        headers: {
          apiKey,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
        cache: "no-store",
      });
      // A definite HTTP refusal is safe for the outbox's existing bounded retries.
      if ([400, 401, 403, 405, 415, 422, 429].includes(response.status)) {
        void response.body?.cancel().catch(() => {});
        return {
          kind: "FAILED",
          code: response.status === 429 ? "RATE_LIMITED" : "REQUEST_REJECTED",
        };
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        return { kind: "UNKNOWN", reason: "SMS_HTTP_UNCERTAIN" };
      }
      const text = await cappedText(response);
      if (text === null)
        return { kind: "UNKNOWN", reason: "SMS_RESPONSE_TOO_LARGE" };
      const answer: unknown = JSON.parse(text);
      const recipients = (
        answer as { SMSMessageData?: { Recipients?: unknown } } | null
      )?.SMSMessageData?.Recipients;
      if (!Array.isArray(recipients) || recipients.length !== 1)
        return { kind: "UNKNOWN", reason: "SMS_RECIPIENT_UNCONFIRMED" };
      const recipient = recipients[0] as {
        number?: unknown;
        statusCode?: unknown;
        messageId?: unknown;
      } | null;
      if (
        typeof recipient?.number !== "string" ||
        !/^\+?[1-9]\d{7,14}$/.test(recipient.number) ||
        recipient.number.replace(/^\+/, "") !== input.recipientE164.slice(1)
      )
        return { kind: "UNKNOWN", reason: "SMS_RECIPIENT_UNCONFIRMED" };
      const code =
        typeof recipient.statusCode === "number"
          ? recipient.statusCode
          : typeof recipient.statusCode === "string" &&
              /^\d{3}$/.test(recipient.statusCode)
            ? Number(recipient.statusCode)
            : NaN;
      if ([100, 101, 102].includes(code)) {
        const id = recipient.messageId;
        return {
          kind: "ACCEPTED",
          providerMessageId:
            typeof id === "string" &&
            id !== "None" &&
            /^[A-Za-z0-9_.:-]{1,200}$/.test(id)
              ? id
              : null,
        };
      }
      const rejected = REJECTED.get(code);
      if (rejected) return { kind: "FAILED", code: rejected };
      // RiskHold, provider/server errors and novel statuses may still be sent.
      return { kind: "UNKNOWN", reason: "SMS_STATUS_UNCERTAIN" };
    } catch {
      // Never echo network errors, credentials, private links or provider bodies.
      return { kind: "UNKNOWN", reason: "SMS_RESPONSE_UNCONFIRMED" };
    }
  }
}
