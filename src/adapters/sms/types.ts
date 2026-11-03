// Transactional SMS adapter contract. Provider acceptance is not proof of handset
// delivery, and notifications never decide money or order state.

// FAILED means the provider definitely did not send it (safe to try again). UNKNOWN means it
// may have gone out (never send it again, DR-026); the provider's message id is kept when it
// gave one, so a later delivery report can still be matched.
export type SmsSendResult =
  | { kind: "ACCEPTED"; providerMessageId: string | null }
  | { kind: "FAILED"; code: string }
  | { kind: "UNKNOWN"; reason: string; providerMessageId?: string | null };

export interface SmsAdapter {
  readonly provider: "FAKE" | "AFRICASTALKING" | "DISABLED";
  /** What the recipient's phone shows as the sender (an approved sender ID), when known. */
  readonly senderName?: string | null;
  sendTransactional(input: {
    messageIntentId: string;
    recipientE164: string;
    text: string;
  }): Promise<SmsSendResult>;
}
