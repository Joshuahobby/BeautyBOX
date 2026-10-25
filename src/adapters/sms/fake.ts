import { db } from "@/server/db";
import type { SmsAdapter, SmsSendResult } from "./types";

// Local/test only: sends nothing. Accepted messages land in the simulated handset inbox
// (devsim.sms_messages) so a local reviewer can open the private links they carry.
// Fault scenarios by recipient number suffix (synthetic numbers only):
//   ...0999 -> provider rejects the message (FAILED)
//   ...0998 -> the provider response is lost (UNKNOWN)
export const FAKE_SMS_FAIL_SUFFIX = "0999";
export const FAKE_SMS_UNKNOWN_SUFFIX = "0998";

export class FakeSmsAdapter implements SmsAdapter {
  readonly provider = "FAKE" as const;
  readonly sent: { messageIntentId: string; recipientE164: string; text: string }[] = [];

  constructor(private readonly options: { persist?: boolean } = {}) {}

  async sendTransactional(input: { messageIntentId: string; recipientE164: string; text: string }): Promise<SmsSendResult> {
    const outcome = input.recipientE164.endsWith(FAKE_SMS_FAIL_SUFFIX) ? "FAILED" : input.recipientE164.endsWith(FAKE_SMS_UNKNOWN_SUFFIX) ? "UNKNOWN" : "ACCEPTED";
    if (outcome === "ACCEPTED") this.sent.push(input);
    if (this.options.persist !== false) {
      await db().$executeRaw`
        INSERT INTO devsim.sms_messages (message_intent_id, recipient, body, outcome)
        VALUES (${input.messageIntentId}::uuid, ${input.recipientE164}, ${input.text}, ${outcome})`;
    }
    if (outcome === "FAILED") return { kind: "FAILED", code: "FAKE_UNDELIVERABLE" };
    if (outcome === "UNKNOWN") return { kind: "UNKNOWN", reason: "FAKE_RESPONSE_LOST" };
    return { kind: "ACCEPTED", providerMessageId: `fake-${input.messageIntentId}` };
  }
}

/** Notifications switched off: intents are kept and marked suppressed, nothing is sent. */
export class DisabledSmsAdapter implements SmsAdapter {
  readonly provider = "DISABLED" as const;

  async sendTransactional(): Promise<SmsSendResult> {
    return { kind: "FAILED", code: "SMS_DISABLED" };
  }
}

export type DevsimMessage = { id: string; recipient: string; body: string; outcome: string; createdAt: Date };

/** Simulated inbox for the local review page; never used outside LOCAL/TEST. */
export async function readDevsimInbox(limit = 50): Promise<DevsimMessage[]> {
  const rows = await db().$queryRaw<{ id: string; recipient: string; body: string; outcome: string; created_at: Date }[]>`
    SELECT id, recipient, body, outcome, created_at FROM devsim.sms_messages ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, recipient: r.recipient, body: r.body, outcome: r.outcome, createdAt: r.created_at }));
}
