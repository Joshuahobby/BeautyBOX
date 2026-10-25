// Transactional SMS adapter contract. Provider acceptance is not proof of handset
// delivery, and notifications never decide money or order state.

export type SmsSendResult =
  | { kind: "ACCEPTED"; providerMessageId: string | null }
  | { kind: "FAILED"; code: string }
  | { kind: "UNKNOWN"; reason: string };

export interface SmsAdapter {
  readonly provider: "FAKE" | "AFRICASTALKING" | "DISABLED";
  sendTransactional(input: {
    messageIntentId: string;
    recipientE164: string;
    text: string;
  }): Promise<SmsSendResult>;
}
