import "server-only";
import type { SmsAdapter, SmsSendResult } from "./types";

// Africa's Talking SMS (I11, DR-048). Contract from developers.africastalking.com, read
// 2026-11-01 ("Bulk (legacy)", "SMS Notifications", "Idempotent Requests", "Request Headers");
// notes in docs/integrations/AFRICASTALKING.md. The classic endpoint POST /version1/messaging
// (form-encoded, apiKey header) is used because the newer JSON endpoint /messaging/bulk has no
// sandbox yet. Africa's Talking offers no idempotency key for SMS, so (DR-026):
// - FAILED only when Africa's Talking said it did not send the message (a refused request or a
//   per-recipient refusal code). The handler may try again a few times.
// - UNKNOWN for anything that may have gone out: timeouts, network errors, HTTP 5xx, unreadable
//   answers, RiskHold, InternalServerError, GatewayError. Such a message is never sent again.
// - ACCEPTED (Processed, Sent, Queued) is the provider's acceptance only, not handset delivery.
// The API key travels only in the apiKey header; neither it nor the message text is logged or
// returned.

export const AFRICASTALKING_BASE_URLS = { sandbox: "https://api.sandbox.africastalking.com", live: "https://api.africastalking.com" } as const;
/** Africa's Talking's shared sandbox account name; any other username is a live account. */
export const AFRICASTALKING_SANDBOX_USERNAME = "sandbox";
export const AFRICASTALKING_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export function africasTalkingBaseUrl(username: string): string {
  return username === AFRICASTALKING_SANDBOX_USERNAME ? AFRICASTALKING_BASE_URLS.sandbox : AFRICASTALKING_BASE_URLS.live;
}

export type AfricasTalkingConfig = {
  username: string;
  apiKey: string;
  /** Approved alphanumeric sender ID or short code. Without it Africa's Talking uses its default. */
  senderId?: string;
  /** Tests only (a simulated API); deployments always use the address for the username. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** Per-recipient codes that mean the message was not sent. */
const NOT_SENT: ReadonlyMap<number, string> = new Map([
  [402, "INVALID_SENDER_ID"],
  [403, "INVALID_PHONE_NUMBER"],
  [404, "UNSUPPORTED_NUMBER_TYPE"],
  [405, "INSUFFICIENT_BALANCE"],
  [406, "USER_IN_BLACKLIST"],
  [407, "COULD_NOT_ROUTE"],
  [409, "DO_NOT_DISTURB_REJECTION"],
  [502, "REJECTED_BY_GATEWAY"],
]);
/** Processed, Sent, Queued. */
const ACCEPTED: ReadonlySet<number> = new Set([100, 101, 102]);
/** The same refusals named in the summary when no recipient entry comes back. */
const NOT_SENT_SUMMARIES: ReadonlyMap<string, string> = new Map([
  ["invalidsenderid", "INVALID_SENDER_ID"],
  ["invalidphonenumber", "INVALID_PHONE_NUMBER"],
  ["unsupportednumbertype", "UNSUPPORTED_NUMBER_TYPE"],
  ["insufficientbalance", "INSUFFICIENT_BALANCE"],
  ["userinblacklist", "USER_IN_BLACKLIST"],
  ["couldnotroute", "COULD_NOT_ROUTE"],
  ["donotdisturbrejection", "DO_NOT_DISTURB_REJECTION"],
]);

type Recipient = { statusCode?: unknown; number?: unknown; status?: unknown; messageId?: unknown };
type Answer = { SMSMessageData?: { Message?: unknown; Recipients?: unknown } };

const digits = (v: string) => v.replace(/\D/g, "");

function messageIdOf(recipient: Recipient): string | null {
  const id = recipient.messageId;
  return typeof id === "string" && id !== "None" && /^[A-Za-z0-9_.:-]{1,200}$/.test(id) ? id : null;
}

/** Reads a response body up to a limit; null when it is larger (never parse unbounded input). */
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads Africa's Talking's answer about one recipient. Exported for tests. */
export function classifyAnswer(httpStatus: number, bodyText: string, recipientE164: string): SmsSendResult {
  // Refused before anything was processed.
  if (httpStatus === 401 || httpStatus === 403) return { kind: "FAILED", code: "AUTHENTICATION" };
  if (httpStatus === 429) return { kind: "FAILED", code: "RATE_LIMITED" };
  if (httpStatus >= 500) return { kind: "UNKNOWN", reason: `http ${httpStatus}` };

  let answer: Answer | null = null;
  try {
    const parsed: unknown = bodyText ? JSON.parse(bodyText) : null;
    if (parsed && typeof parsed === "object" && "SMSMessageData" in parsed) answer = parsed as Answer;
  } catch {
    answer = null;
  }
  if (!answer) {
    // A 4xx with a plain-text explanation is a refused request: nothing was sent.
    if (httpStatus >= 400 && httpStatus < 500) {
      const code = /sender/i.test(bodyText) ? "INVALID_SENDER_ID" : /phone|number/i.test(bodyText) ? "INVALID_PHONE_NUMBER" : "REQUEST_REFUSED";
      return { kind: "FAILED", code };
    }
    return { kind: "UNKNOWN", reason: httpStatus >= 200 && httpStatus < 300 ? "unreadable answer" : `http ${httpStatus}` };
  }

  const data = answer.SMSMessageData ?? {};
  const recipients = Array.isArray(data.Recipients) ? (data.Recipients as Recipient[]) : [];
  if (recipients.length === 0) {
    const summary = typeof data.Message === "string" ? data.Message.trim() : "";
    const named = NOT_SENT_SUMMARIES.get(summary.replace(/[^A-Za-z]/g, "").toLowerCase());
    if (named) return { kind: "FAILED", code: named };
    if (/^Sent to 0\/\d+/i.test(summary)) return { kind: "FAILED", code: "NOT_SENT" };
    return { kind: "UNKNOWN", reason: "no recipient in the answer" };
  }
  // Only ever apply an answer about the number that was asked about.
  if (recipients.length !== 1) return { kind: "UNKNOWN", reason: "answer lists several recipients" };
  const recipient = recipients[0]!;
  if (typeof recipient.number !== "string" || digits(recipient.number) !== digits(recipientE164)) {
    return { kind: "UNKNOWN", reason: "answer is for another number" };
  }
  const code = typeof recipient.statusCode === "number" ? recipient.statusCode : Number(recipient.statusCode);
  const messageId = messageIdOf(recipient);
  if (ACCEPTED.has(code)) return { kind: "ACCEPTED", providerMessageId: messageId };
  const notSent = NOT_SENT.get(code);
  if (notSent) return { kind: "FAILED", code: notSent };
  // 401 RiskHold (held for review, may still be released), 500 InternalServerError,
  // 501 GatewayError and anything new: the message may have gone out.
  return { kind: "UNKNOWN", reason: `recipient status ${Number.isFinite(code) ? code : "missing"}`, providerMessageId: messageId };
}

export class AfricasTalkingSmsAdapter implements SmsAdapter {
  readonly provider = "AFRICASTALKING" as const;
  readonly senderName: string | null;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: AfricasTalkingConfig) {
    this.url = `${(config.baseUrl ?? africasTalkingBaseUrl(config.username)).replace(/\/+$/, "")}/version1/messaging`;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? AFRICASTALKING_TIMEOUT_MS;
    this.senderName = config.senderId ?? null;
  }

  async sendTransactional(input: { messageIntentId: string; recipientE164: string; text: string }): Promise<SmsSendResult> {
    // Checked here so a malformed number never reaches the provider (nothing is sent).
    if (!/^\+[1-9]\d{7,14}$/.test(input.recipientE164)) return { kind: "FAILED", code: "INVALID_RECIPIENT" };
    if (input.text.trim().length === 0) return { kind: "FAILED", code: "EMPTY_MESSAGE" };
    const body = new URLSearchParams({ username: this.config.username, to: input.recipientE164, message: input.text, bulkSMSMode: "1" });
    if (this.config.senderId) body.set("from", this.config.senderId);

    let res: Response;
    let text: string | null;
    try {
      res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { apiKey: this.config.apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
        cache: "no-store",
      });
      text = await readCapped(res, MAX_RESPONSE_BYTES);
    } catch (error) {
      // The request may have reached Africa's Talking. The error class is enough; never the request.
      return { kind: "UNKNOWN", reason: `network: ${error instanceof Error ? error.name : "error"}` };
    }
    if (text === null) return { kind: "UNKNOWN", reason: "answer too large" };
    return classifyAnswer(res.status, text, input.recipientE164);
  }
}
