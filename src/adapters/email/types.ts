// Transactional e-mail adapter contract (DR-059). Provider acceptance is not proof
// that the message reached the inbox, and notifications never decide money or order
// state. Same outcome classes as SMS (DR-026): FAILED means definitely not sent and may
// be retried; UNKNOWN may have been sent and is never blindly resent.

export type EmailSendResult =
  | { kind: "ACCEPTED"; providerMessageId: string | null }
  | { kind: "FAILED"; code: string }
  | { kind: "UNKNOWN"; reason: string };

export type EmailMessage = {
  messageIntentId: string;
  /** Changes on every attempt, so a provider-side idempotency key never joins two bodies. */
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

export interface EmailAdapter {
  readonly provider: "FAKE" | "RESEND" | "DISABLED";
  sendTransactional(message: EmailMessage): Promise<EmailSendResult>;
}
