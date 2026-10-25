import "server-only";
import type { KeyObject } from "node:crypto";
import { sha256Hex } from "@/server/crypto";
import {
  algorithmForKey,
  contentDigestMatches,
  parsePrivateKey,
  parsePublicKey,
  parseSignature,
  parseSignatureInput,
  signatureBase,
  signRequest,
  SIGNATURE_LABEL,
  verifyBase,
} from "./http-signatures";
import type {
  CallbackRequest,
  CallbackVerification,
  DepositRequest,
  DepositStatus,
  EnabledMethods,
  InitiationResult,
  PaymentAdapter,
  PaymentMethodCode,
  RefundRequest,
  RefundStatus,
} from "./types";

// pawaPay Merchant API v2 (I07, DR-042). Contract taken from docs.pawapay.io/v2 (deposits,
// refunds, signatures, active configuration, public keys), reviewed 2026-10-24; notes in
// docs/integrations/PAWAPAY.md. Rules that keep money safe:
// - Initiation acceptance is never success. Only a status check returning COMPLETED is.
// - A timeout, network error, HTTP 5xx or unreadable answer is UNKNOWN: the caller looks the
//   same id up before anything else and never sends a new id because a response was lost.
// - NOT_FOUND from a status check is the only proof that an initiation never reached pawaPay.
// - pawaPay's failureMessage is for operators; it is never returned to customers.
// - Callbacks are trusted only with a valid signature from a pawaPay public key over the exact
//   body, and even then they only prompt an authoritative status check.

export const PAWAPAY_BASE_URLS = { sandbox: "https://api.sandbox.pawapay.io", production: "https://api.pawapay.io" } as const;
export const PAWAPAY_TIMEOUT_MS = 15_000;
/** How far a callback signature's "created" may be from now (pawaPay re-signs every delivery). */
export const CALLBACK_MAX_AGE_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 60;
const KEY_REFRESH_MIN_INTERVAL_MS = 60_000;
const CALLBACK_REQUIRED_COMPONENTS = ["@method", "@authority", "@path", "content-digest"];
const APPROVED_METHODS: readonly PaymentMethodCode[] = ["MTN_MOMO_RWA", "AIRTEL_RWA"];
const CONTENT_TYPE = "application/json; charset=UTF-8";

export type PawapayConfig = {
  baseUrl: string;
  apiToken: string;
  /** Request signing (only when "Only accept signed requests" is enabled in the dashboard). */
  signing?: { keyId: string; privateKeyPem: string };
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
};

type HttpResult = { kind: "response"; status: number; body: unknown } | { kind: "network"; reason: string };

type FailureReason = { failureCode?: unknown; failureMessage?: unknown };
// The refunds guide also shows rejections as rejectionReason.rejectionCode; both are read.
type InitiationBody = { status?: unknown; failureReason?: FailureReason; rejectionReason?: { rejectionCode?: unknown; rejectionMessage?: unknown } };
type TransactionData = {
  depositId?: unknown;
  refundId?: unknown;
  status?: unknown;
  amount?: unknown;
  currency?: unknown;
  providerTransactionId?: unknown;
  failureReason?: FailureReason;
};
type SearchBody = { status?: unknown; data?: TransactionData };

const asString = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const failureCodeOf = (reason: FailureReason | undefined, fallback = "UNKNOWN_ERROR") => asString(reason?.failureCode) ?? fallback;
const rejectionCodeOf = (body: InitiationBody): string | null => asString(body.failureReason?.failureCode) ?? asString(body.rejectionReason?.rejectionCode);
const rejectionMessageOf = (body: InitiationBody): string => asString(body.failureReason?.failureMessage) ?? asString(body.rejectionReason?.rejectionMessage) ?? "";
/** pawaPay: with UNKNOWN_ERROR "it is not safe to assume the initiation has failed". */
const AMBIGUOUS_REJECTIONS: ReadonlySet<string> = new Set(["UNKNOWN_ERROR"]);
/** Refund refusals caused by our token, signature or account permissions: fixed on our side, then the same refund goes through. */
const REFUND_ACCESS_REFUSALS: ReadonlySet<string> = new Set(["AUTHENTICATION_ERROR", "AUTHORISATION_ERROR", "NO_AUTHENTICATION", "HTTP_SIGNATURE_ERROR", "REFUNDS_NOT_ALLOWED"]);
/** Refund refusals that mean pawaPay's record of the payment disagrees with ours (less left, already refunded, not completed, unknown deposit). */
const REFUND_CONFLICTS: ReadonlySet<string> = new Set(["INVALID_AMOUNT", "INVALID_STATE", "DEPOSIT_NOT_COMPLETED", "DEPOSIT_NOT_FOUND", "NOT_FOUND"]);

/**
 * Reads a coded refund refusal (sandbox answers of 2026-10-24, DR-043). Nothing is created for a
 * refused id, and pawaPay accepts the same id again later. A refund sent while another is
 * processing comes back INVALID_STATE "A refund is already in progress for this deposit." (the
 * docs name REFUND_IN_PROGRESS); INVALID_STATE also means "already refunded", so only the
 * in-progress wording is temporary.
 */
function refundRefusal(code: string, message: string): InitiationResult {
  if (code === "REFUND_IN_PROGRESS" || (code === "INVALID_STATE" && /in progress/i.test(message))) return { kind: "UNKNOWN", reason: `rejected for now: ${code}`, refusedForNow: "BUSY" };
  if (code === "PROVIDER_TEMPORARILY_UNAVAILABLE") return { kind: "UNKNOWN", reason: `rejected for now: ${code}`, refusedForNow: "UNAVAILABLE" };
  if (REFUND_ACCESS_REFUSALS.has(code)) return { kind: "UNKNOWN", reason: `rejected for now: ${code}`, refusedForNow: "ACCESS" };
  return REFUND_CONFLICTS.has(code) ? { kind: "REJECTED", failureCode: code, conflict: true } : { kind: "REJECTED", failureCode: code };
}
const MAX_RESPONSE_BYTES = 1_000_000;

/** "100", "100.00" -> 100; anything with a non-zero fraction or out of range -> null. */
export function wholeRwf(amount: unknown): number | null {
  const text = asString(amount);
  const m = text ? /^(\d{1,15})(?:\.(\d+))?$/.exec(text) : null;
  if (!m || (m[2] && !/^0+$/.test(m[2]))) return null;
  const value = Number(m[1]);
  return Number.isSafeInteger(value) ? value : null;
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

/** pawaPay accepts 4-22 letters, digits and spaces; anything else is dropped. */
export function walletMessage(text: string): string | undefined {
  const cleaned = text.replace(/[^A-Za-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 22).trim();
  return cleaned.length >= 4 ? cleaned : undefined;
}

export class PawapayPaymentAdapter implements PaymentAdapter {
  readonly provider = "PAWAPAY" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly signingKey: { keyId: string; key: KeyObject } | null;
  private publicKeys = new Map<string, KeyObject>();
  private keysFetchedAt = 0;

  constructor(private readonly config: PawapayConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? PAWAPAY_TIMEOUT_MS;
    this.now = config.now ?? (() => new Date());
    // Parsed once so a malformed or unsupported key fails when the adapter is configured,
    // without echoing it.
    this.signingKey = config.signing ? { keyId: config.signing.keyId, key: parsePrivateKey(config.signing.privateKeyPem) } : null;
    if (this.signingKey) algorithmForKey(this.signingKey.key);
  }

  // ------------------------------------------------------------------ HTTP

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<HttpResult> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.config.apiToken}`, Accept: "application/json" };
    let payload: string | undefined;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["Content-Type"] = CONTENT_TYPE;
      if (this.signingKey) {
        Object.assign(headers, signRequest({ method, url, body: payload, contentType: CONTENT_TYPE, keyId: this.signingKey.keyId, privateKey: this.signingKey.key, now: this.now() }));
      }
    }
    try {
      const res = await this.fetchImpl(url, { method, headers, body: payload, signal: AbortSignal.timeout(this.timeoutMs), redirect: "error", cache: "no-store" });
      const text = await readCapped(res, MAX_RESPONSE_BYTES);
      if (text === null) return { kind: "network", reason: "response too large" };
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return { kind: "response", status: res.status, body: parsed };
    } catch (error) {
      // Never include the URL's secrets or the request; the error class is enough.
      return { kind: "network", reason: error instanceof Error ? error.name : "network error" };
    }
  }

  private initiation(result: HttpResult, readRefusal: (code: string, message: string) => InitiationResult = (code) => ({ kind: "REJECTED", failureCode: code })): InitiationResult {
    if (result.kind === "network") return { kind: "UNKNOWN", reason: `network: ${result.reason}` };
    const body = (result.body ?? {}) as InitiationBody;
    const rejected = (): InitiationResult => {
      const code = rejectionCodeOf(body);
      // Only a specific refusal is definitive. A missing code or UNKNOWN_ERROR is not proof
      // that nothing was created, so the caller looks the same id up first.
      if (code === null || AMBIGUOUS_REJECTIONS.has(code)) return { kind: "UNKNOWN", reason: `rejected without a definite reason: ${code ?? "none"}` };
      return readRefusal(code, rejectionMessageOf(body));
    };
    if (result.status === 200) {
      if (body.status === "ACCEPTED") return { kind: "ACCEPTED", providerStatus: "ACCEPTED" };
      if (body.status === "DUPLICATE_IGNORED") return { kind: "DUPLICATE", providerStatus: "DUPLICATE_IGNORED" };
      if (body.status === "REJECTED") return rejected();
      return { kind: "UNKNOWN", reason: "unrecognised initiation answer" };
    }
    // 400/401/403 naming a refusal (status REJECTED, or only failureReason, as the sandbox
    // answers a bad token): pawaPay refused the request, so nothing was created for this id.
    // 5xx (pawaPay: "not safe to assume the initiation has failed") and any other status are
    // unknown outcomes.
    if ((result.status === 400 || result.status === 401 || result.status === 403) && (body.status === "REJECTED" || rejectionCodeOf(body) !== null)) return rejected();
    return { kind: "UNKNOWN", reason: `http ${result.status}` };
  }

  private evidence(kind: "deposit" | "refund", id: string, status: string, providerTransactionId: string | null) {
    return { ref: `pawapay:${kind}:${id}:${status}${providerTransactionId ? `:${providerTransactionId}` : ""}`, observedAt: this.now().toISOString() };
  }

  // ------------------------------------------------------------------ Methods

  async getEnabledMethods(): Promise<EnabledMethods> {
    const result = await this.call("GET", "/v2/active-conf?country=RWA&operationType=DEPOSIT");
    if (result.kind !== "response" || result.status !== 200 || typeof result.body !== "object" || result.body === null) return { methods: [], healthy: false };
    const countries = (result.body as { countries?: unknown }).countries;
    if (!Array.isArray(countries)) return { methods: [], healthy: false };
    const rwanda = countries.find((c) => (c as { country?: unknown }).country === "RWA") as { providers?: unknown } | undefined;
    const providers = Array.isArray(rwanda?.providers) ? (rwanda.providers as { provider?: unknown; currencies?: unknown }[]) : [];
    const methods = APPROVED_METHODS.filter((method) =>
      providers.some((p) => {
        if (p.provider !== method || !Array.isArray(p.currencies)) return false;
        return (p.currencies as { currency?: unknown; operationTypes?: Record<string, { status?: unknown } | undefined> }[]).some((c) => {
          const deposit = c.currency === "RWF" ? c.operationTypes?.DEPOSIT : undefined;
          return deposit !== undefined && deposit.status !== "CLOSED";
        });
      }),
    );
    return { methods, healthy: true };
  }

  async initiateDeposit(request: DepositRequest): Promise<InitiationResult> {
    if (!Number.isSafeInteger(request.amountRwf) || request.amountRwf < 1) return { kind: "REJECTED", failureCode: "INVALID_AMOUNT" };
    const message = walletMessage(request.customerMessage);
    const result = await this.call("POST", "/v2/deposits", {
      depositId: request.depositId,
      amount: String(request.amountRwf),
      currency: "RWF",
      payer: { type: "MMO", accountDetails: { phoneNumber: request.payerMsisdn, provider: request.method } },
      clientReferenceId: request.clientReference,
      ...(message ? { customerMessage: message } : {}),
    });
    return this.initiation(result);
  }

  async getDeposit(depositId: string): Promise<DepositStatus> {
    const result = await this.call("GET", `/v2/deposits/${encodeURIComponent(depositId)}`);
    if (result.kind === "network") return { kind: "UNKNOWN", reason: `network: ${result.reason}` };
    if (result.status !== 200) return { kind: "UNKNOWN", reason: `http ${result.status}` };
    const body = (result.body ?? {}) as SearchBody;
    if (body.status === "NOT_FOUND") return { kind: "NOT_FOUND" };
    if (body.status !== "FOUND" || !body.data) return { kind: "UNKNOWN", reason: "unrecognised status answer" };
    // Only ever apply an answer about the deposit that was asked about.
    if (asString(body.data.depositId) !== depositId) return { kind: "UNKNOWN", reason: "status answer is for another deposit" };
    const status = asString(body.data.status) ?? "UNKNOWN";
    const providerTransactionId = asString(body.data.providerTransactionId);
    if (status === "COMPLETED") {
      return {
        kind: "SUCCEEDED",
        providerStatus: status,
        amountRwf: wholeRwf(body.data.amount),
        currency: asString(body.data.currency) ?? "",
        providerTransactionId,
        evidence: this.evidence("deposit", depositId, status, providerTransactionId),
      };
    }
    if (status === "FAILED") {
      return { kind: "FAILED", providerStatus: status, failureCode: failureCodeOf(body.data.failureReason), evidence: this.evidence("deposit", depositId, status, providerTransactionId) };
    }
    // ACCEPTED, PROCESSING, IN_RECONCILIATION and anything new: not final.
    return { kind: "PENDING", providerStatus: status };
  }

  async initiateRefund(request: RefundRequest): Promise<InitiationResult> {
    if (!Number.isSafeInteger(request.amountRwf) || request.amountRwf < 1) return { kind: "REJECTED", failureCode: "INVALID_AMOUNT" };
    const result = await this.call("POST", "/v2/refunds", {
      refundId: request.refundId,
      depositId: request.depositId,
      // Always explicit, also for a full refund, so the amount refunded is the amount reserved.
      amount: String(request.amountRwf),
      currency: "RWF",
    });
    return this.initiation(result, refundRefusal);
  }

  async getRefund(refundId: string): Promise<RefundStatus> {
    const result = await this.call("GET", `/v2/refunds/${encodeURIComponent(refundId)}`);
    if (result.kind === "network") return { kind: "UNKNOWN", reason: `network: ${result.reason}` };
    if (result.status !== 200) return { kind: "UNKNOWN", reason: `http ${result.status}` };
    const body = (result.body ?? {}) as SearchBody;
    if (body.status === "NOT_FOUND") return { kind: "NOT_FOUND" };
    if (body.status !== "FOUND" || !body.data) return { kind: "UNKNOWN", reason: "unrecognised status answer" };
    if (asString(body.data.refundId) !== refundId) return { kind: "UNKNOWN", reason: "status answer is for another refund" };
    const status = asString(body.data.status) ?? "UNKNOWN";
    const providerTransactionId = asString(body.data.providerTransactionId);
    if (status === "COMPLETED") {
      return {
        kind: "SUCCEEDED",
        providerStatus: status,
        amountRwf: wholeRwf(body.data.amount),
        currency: asString(body.data.currency) ?? "",
        evidence: this.evidence("refund", refundId, status, providerTransactionId),
      };
    }
    if (status === "FAILED") {
      return { kind: "FAILED", providerStatus: status, failureCode: failureCodeOf(body.data.failureReason), evidence: this.evidence("refund", refundId, status, providerTransactionId) };
    }
    // ACCEPTED, ENQUEUED, PROCESSING, IN_RECONCILIATION and anything new: not final.
    return { kind: "PENDING", providerStatus: status };
  }

  // ------------------------------------------------------------------ Callbacks

  /** pawaPay's callback-signing public keys, refreshed when an unknown key id appears (rate-limited). */
  private async publicKey(keyId: string): Promise<KeyObject | null> {
    const cached = this.publicKeys.get(keyId);
    if (cached) return cached;
    const t = this.now().getTime();
    if (t - this.keysFetchedAt < KEY_REFRESH_MIN_INTERVAL_MS) return null;
    this.keysFetchedAt = t;
    const result = await this.call("GET", "/v2/public-key/http");
    if (result.kind !== "response" || result.status !== 200 || !Array.isArray(result.body)) return null;
    const next = new Map<string, KeyObject>();
    for (const item of result.body as { id?: unknown; key?: unknown }[]) {
      const id = asString(item.id);
      const pem = asString(item.key);
      if (!id || !pem) continue;
      try {
        next.set(id, parsePublicKey(pem));
      } catch {
        // skip a key that cannot be parsed
      }
    }
    if (next.size > 0) this.publicKeys = next;
    return this.publicKeys.get(keyId) ?? null;
  }

  async verifyCallback(request: CallbackRequest): Promise<CallbackVerification> {
    const eventHash = sha256Hex(request.rawBody);
    const invalid = (reason: string): CallbackVerification => ({ verified: false, signature: "INVALID", reason, eventHash });

    const input = parseSignatureInput(request.headers.get("signature-input")).find((s) => s.label === SIGNATURE_LABEL);
    const signature = parseSignature(request.headers.get("signature")).get(SIGNATURE_LABEL);
    if (!input || !signature) return invalid("unsigned callback (enable signed callbacks in the pawaPay dashboard)");
    if (!CALLBACK_REQUIRED_COMPONENTS.every((c) => input.components.includes(c))) return invalid("signature does not cover the required components");
    if (!contentDigestMatches(request.headers.get("content-digest"), request.rawBody)) return invalid("content digest does not match the body");

    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const created = typeof input.params.created === "number" ? input.params.created : null;
    const expires = typeof input.params.expires === "number" ? input.params.expires : null;
    if (created === null || created > nowSeconds + CLOCK_SKEW_SECONDS || created < nowSeconds - CALLBACK_MAX_AGE_SECONDS) return invalid("signature is not fresh");
    if (expires !== null && expires < nowSeconds - CLOCK_SKEW_SECONDS) return invalid("signature has expired");

    const keyId = typeof input.params.keyid === "string" ? input.params.keyid : null;
    const alg = typeof input.params.alg === "string" ? input.params.alg : null;
    if (!keyId || !alg) return invalid("signature parameters missing");
    const key = await this.publicKey(keyId);
    if (!key) return { verified: false, signature: "UNKNOWN_KEY", reason: "unknown signing key", eventHash };

    const base = signatureBase({ method: request.method, url: request.url, headers: request.headers }, input);
    if (!base || !verifyBase(base, signature, alg, key)) return invalid("signature does not verify");

    let body: { depositId?: unknown; refundId?: unknown; status?: unknown };
    try {
      body = JSON.parse(request.rawBody.toString("utf8")) as typeof body;
    } catch {
      return invalid("malformed body");
    }
    const refundId = asString(body.refundId);
    const depositId = asString(body.depositId);
    const reference = refundId ?? depositId;
    if (!reference) return invalid("missing reference");
    return { verified: true, signature: "VERIFIED", kind: refundId ? "REFUND" : "DEPOSIT", reference, claimedStatus: asString(body.status), eventHash };
  }
}
