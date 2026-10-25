// Payment provider adapter contract (handoff technical/Integrations.md).
// Adapters translate provider wire formats into these normalized results. They never
// decide whether an order is fulfillable and never surface provider text to users.

export type PaymentMethodCode = "MTN_MOMO_RWA" | "AIRTEL_RWA";

export type EnabledMethods = {
  methods: PaymentMethodCode[];
  /** false when the provider configuration could not be read or is degraded. */
  healthy: boolean;
};

export type DepositRequest = {
  depositId: string; // persisted before the call; reused on every retry
  amountRwf: number;
  method: PaymentMethodCode;
  payerMsisdn: string; // 2507XXXXXXXX
  customerMessage: string; // short statement text shown in the wallet prompt
  clientReference: string; // order reference
};

export type InitiationResult =
  | { kind: "ACCEPTED"; providerStatus: string }
  /** Provider already has this depositId (lost response, retry). Treat as accepted. */
  | { kind: "DUPLICATE"; providerStatus: string }
  /**
   * Definitive refusal; nothing can happen under this id. `conflict`: the provider's own record
   * of the payment disagrees with the request (for a refund: less left than asked, already
   * refunded, payment not completed or not found).
   */
  | { kind: "REJECTED"; failureCode: string; conflict?: boolean }
  /**
   * Timeout, network or 5xx: outcome unknown. Look the deposit up before any resend.
   * `refusedForNow`: the provider refused without creating anything, for a reason that can pass:
   * another refund for the deposit is in progress (BUSY), our credentials, signature or account
   * permissions (ACCESS), or a provider outage (UNAVAILABLE).
   */
  | { kind: "UNKNOWN"; reason: string; refusedForNow?: "BUSY" | "ACCESS" | "UNAVAILABLE" };

export type ProviderEvidence = {
  /** Opaque reference to what was observed (never secrets or raw PII). */
  ref: string;
  observedAt: string;
};

export type DepositStatus =
  | { kind: "NOT_FOUND" }
  | { kind: "PENDING"; providerStatus: string }
  | {
      kind: "SUCCEEDED";
      providerStatus: string;
      amountRwf: number | null; // null when the provider amount was not a whole RWF value
      currency: string;
      providerTransactionId: string | null;
      evidence: ProviderEvidence;
    }
  | { kind: "FAILED"; providerStatus: string; failureCode: string; evidence: ProviderEvidence }
  | { kind: "UNKNOWN"; reason: string };

export type RefundRequest = {
  refundId: string; // persisted before the call
  depositId: string;
  amountRwf: number; // always explicit, even for a full refund
};

export type RefundStatus =
  | { kind: "NOT_FOUND" }
  | { kind: "PENDING"; providerStatus: string }
  | {
      kind: "SUCCEEDED";
      providerStatus: string;
      amountRwf: number | null; // null when the provider amount was not a whole RWF value: a mismatch
      currency: string;
      evidence: ProviderEvidence;
    }
  | { kind: "FAILED"; providerStatus: string; failureCode: string; evidence: ProviderEvidence }
  | { kind: "UNKNOWN"; reason: string };

export type CallbackRequest = {
  rawBody: Buffer;
  headers: Headers;
  method: string;
  /** Absolute URL of the request as the provider signed it (after verified proxy mapping). */
  url: string;
};

export type CallbackVerification =
  | {
      verified: true;
      signature: "VERIFIED" | "SIMULATED";
      kind: "DEPOSIT" | "REFUND";
      reference: string; // depositId or refundId
      claimedStatus: string | null;
      eventHash: string;
    }
  | { verified: false; signature: "INVALID" | "UNKNOWN_KEY"; reason: string; eventHash: string };

export interface PaymentAdapter {
  readonly provider: "PAWAPAY" | "FAKE";
  getEnabledMethods(): Promise<EnabledMethods>;
  initiateDeposit(request: DepositRequest): Promise<InitiationResult>;
  getDeposit(depositId: string): Promise<DepositStatus>;
  verifyCallback(request: CallbackRequest): Promise<CallbackVerification>;
  initiateRefund(request: RefundRequest): Promise<InitiationResult>;
  getRefund(refundId: string): Promise<RefundStatus>;
}
