import { db } from "@/server/db";
import type { EmailAdapter, EmailMessage, EmailSendResult } from "./types";

// Local/test only: sends nothing. Accepted messages land in the simulated mailbox
// (devsim.email_messages) so a local reviewer can open the private links they carry.
// Fault scenarios by recipient address (synthetic addresses only):
//   fail@...    -> provider rejects the message (FAILED)
//   unknown@... -> the provider response is lost (UNKNOWN)
export const FAKE_EMAIL_FAIL_PREFIX = "fail@";
export const FAKE_EMAIL_UNKNOWN_PREFIX = "unknown@";

export class FakeEmailAdapter implements EmailAdapter {
  readonly provider = "FAKE" as const;
  readonly sent: EmailMessage[] = [];

  constructor(private readonly options: { persist?: boolean } = {}) {}

  async sendTransactional(message: EmailMessage): Promise<EmailSendResult> {
    const outcome = message.to.startsWith(FAKE_EMAIL_FAIL_PREFIX)
      ? "FAILED"
      : message.to.startsWith(FAKE_EMAIL_UNKNOWN_PREFIX)
        ? "UNKNOWN"
        : "ACCEPTED";
    if (outcome === "ACCEPTED") this.sent.push(message);
    if (this.options.persist !== false) {
      await db().$executeRaw`
        INSERT INTO devsim.email_messages (message_intent_id, recipient, subject, body, outcome)
        VALUES (${message.messageIntentId}::uuid, ${message.to}, ${message.subject}, ${message.text}, ${outcome})`;
    }
    if (outcome === "FAILED")
      return { kind: "FAILED", code: "FAKE_UNDELIVERABLE" };
    if (outcome === "UNKNOWN")
      return { kind: "UNKNOWN", reason: "FAKE_RESPONSE_LOST" };
    return {
      kind: "ACCEPTED",
      providerMessageId: `fake-${message.messageIntentId}`,
    };
  }
}

/** E-mail switched off: intents are kept and marked suppressed, nothing is sent. */
export class DisabledEmailAdapter implements EmailAdapter {
  readonly provider = "DISABLED" as const;

  async sendTransactional(): Promise<EmailSendResult> {
    return { kind: "FAILED", code: "EMAIL_DISABLED" };
  }
}

export type DevsimEmail = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  outcome: string;
  createdAt: Date;
};

/** Simulated mailbox for the local review page; never used outside LOCAL/TEST. */
export async function readDevsimMailbox(limit = 50): Promise<DevsimEmail[]> {
  const rows = await db().$queryRaw<
    {
      id: string;
      recipient: string;
      subject: string;
      body: string;
      outcome: string;
      created_at: Date;
    }[]
  >`SELECT id, recipient, subject, body, outcome, created_at FROM devsim.email_messages ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    recipient: r.recipient,
    subject: r.subject,
    body: r.body,
    outcome: r.outcome,
    createdAt: r.created_at,
  }));
}
