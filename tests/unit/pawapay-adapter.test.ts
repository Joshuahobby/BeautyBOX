import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PawapayPaymentAdapter, walletMessage, wholeRwf } from "@/adapters/payments/pawapay";
import { startPawapayMock, type PawapayMock } from "../support/pawapay-mock";

// The pawaPay v2 adapter (I07, DR-042) against a local imitation of the documented API.
// Real HTTP and real cryptography; nothing here talks to pawaPay.

let mock: PawapayMock;
beforeAll(async () => {
  mock = await startPawapayMock();
});
afterAll(() => mock.close());

const adapter = (extra: Partial<ConstructorParameters<typeof PawapayPaymentAdapter>[0]> = {}) =>
  new PawapayPaymentAdapter({ baseUrl: mock.url, apiToken: mock.token, timeoutMs: 2_000, ...extra });

const deposit = (overrides: Partial<Parameters<PawapayPaymentAdapter["initiateDeposit"]>[0]> = {}) => ({
  depositId: randomUUID(),
  amountRwf: 12_500,
  method: "MTN_MOMO_RWA" as const,
  payerMsisdn: "250783456789",
  customerMessage: "BeautyBOX order",
  clientReference: "BB-TEST-0001",
  ...overrides,
});

describe("enabled methods (active configuration)", () => {
  it("lists the approved Rwanda providers that are open for deposits", async () => {
    expect(await adapter().getEnabledMethods()).toEqual({ methods: ["MTN_MOMO_RWA", "AIRTEL_RWA"], healthy: true });
    mock.closedProviders.add("AIRTEL_RWA");
    expect(await adapter().getEnabledMethods()).toEqual({ methods: ["MTN_MOMO_RWA"], healthy: true });
    mock.closedProviders.clear();
  });

  it("reports itself unhealthy when the configuration cannot be read", async () => {
    expect(await adapter({ apiToken: "wrong" }).getEnabledMethods()).toEqual({ methods: [], healthy: false });
  });
});

describe("deposits", () => {
  it("accepts, ignores a duplicate, and reports success only from a status check", async () => {
    const a = adapter();
    const req = deposit();
    expect(await a.initiateDeposit(req)).toEqual({ kind: "ACCEPTED", providerStatus: "ACCEPTED" });
    expect(await a.initiateDeposit(req)).toEqual({ kind: "DUPLICATE", providerStatus: "DUPLICATE_IGNORED" });
    const status = await a.getDeposit(req.depositId);
    expect(status).toMatchObject({ kind: "SUCCEEDED", providerStatus: "COMPLETED", amountRwf: 12_500, currency: "RWF", providerTransactionId: `MOCK-${req.depositId.slice(0, 8)}` });
    expect(status.kind === "SUCCEEDED" && status.evidence.ref).toBe(`pawapay:deposit:${req.depositId}:COMPLETED:MOCK-${req.depositId.slice(0, 8)}`);
    // What was sent matches the documented request (the imitation refuses unknown fields).
    const sent = mock.deposits.get(req.depositId)!;
    expect(sent).toMatchObject({ amount: 12_500, currency: "RWF", phone: "250783456789", provider: "MTN_MOMO_RWA" });
  });

  it("treats a lost response, an HTTP 500, a timeout and a refused connection as unknown, never as failed", async () => {
    const a = adapter({ timeoutMs: 300 });
    const lost = deposit();
    mock.faults.push({ method: "POST", pathPrefix: "/v2/deposits", fault: "dropAfterAccept" });
    expect((await a.initiateDeposit(lost)).kind).toBe("UNKNOWN");
    // The deposit did reach pawaPay: looking it up finds it, and re-sending the same id is a duplicate.
    expect((await a.getDeposit(lost.depositId)).kind).toBe("SUCCEEDED");
    expect((await a.initiateDeposit(lost)).kind).toBe("DUPLICATE");

    mock.faults.push({ method: "POST", pathPrefix: "/v2/deposits", fault: "http500" });
    expect(await a.initiateDeposit(deposit())).toMatchObject({ kind: "UNKNOWN", reason: "http 500" });
    mock.faults.push({ method: "POST", pathPrefix: "/v2/deposits", fault: "hang" });
    expect(await a.initiateDeposit(deposit())).toMatchObject({ kind: "UNKNOWN", reason: "network: TimeoutError" });
    mock.faults.push({ method: "GET", pathPrefix: "/v2/deposits/", fault: "http500" });
    expect(await a.getDeposit(lost.depositId)).toMatchObject({ kind: "UNKNOWN" });

    const nowhere = new PawapayPaymentAdapter({ baseUrl: "http://127.0.0.1:9", apiToken: "x", timeoutMs: 300 });
    expect((await nowhere.initiateDeposit(deposit())).kind).toBe("UNKNOWN");
    expect((await nowhere.getDeposit(lost.depositId)).kind).toBe("UNKNOWN");
  });

  it("maps definitive refusals and final failures with pawaPay's codes", async () => {
    const a = adapter();
    expect(await a.initiateDeposit(deposit({ amountRwf: 6_000_000 }))).toEqual({ kind: "REJECTED", failureCode: "AMOUNT_OUT_OF_BOUNDS" });
    expect(await adapter({ apiToken: "wrong" }).initiateDeposit(deposit())).toEqual({ kind: "REJECTED", failureCode: "AUTHENTICATION_ERROR" });
    mock.closedProviders.add("MTN_MOMO_RWA");
    expect(await a.initiateDeposit(deposit())).toEqual({ kind: "REJECTED", failureCode: "PROVIDER_TEMPORARILY_UNAVAILABLE" });
    mock.closedProviders.clear();

    const declined = deposit({ payerMsisdn: "250783456039" }); // sandbox: PAYMENT_NOT_APPROVED
    await a.initiateDeposit(declined);
    expect(await a.getDeposit(declined.depositId)).toMatchObject({ kind: "FAILED", providerStatus: "FAILED", failureCode: "PAYMENT_NOT_APPROVED" });
    const stuck = deposit({ payerMsisdn: "250783456129" }); // sandbox: never final
    await a.initiateDeposit(stuck);
    expect((await a.getDeposit(stuck.depositId)).kind).toBe("PENDING");
    expect(await a.getDeposit(randomUUID())).toEqual({ kind: "NOT_FOUND" });
  });

  it("an ambiguous refusal (UNKNOWN_ERROR or no reason) is unknown, never a definitive failure", async () => {
    const a = adapter();
    mock.faults.push({ method: "POST", pathPrefix: "/v2/deposits", fault: "reject:UNKNOWN_ERROR" });
    expect(await a.initiateDeposit(deposit())).toMatchObject({ kind: "UNKNOWN" });
    mock.faults.push({ method: "POST", pathPrefix: "/v2/deposits", fault: "reject:" });
    expect(await a.initiateDeposit(deposit())).toMatchObject({ kind: "UNKNOWN" });
  });

  it("authentication failures (401 or 403; the sandbox's body or the documented one) are refusals for deposits and unknown for status checks", async () => {
    try {
      for (const status of [401, 403] as const) {
        for (const shape of ["sandbox", "documented"] as const) {
          mock.authFailureStatus = status;
          mock.authFailureShape = shape;
          const wrong = adapter({ apiToken: "wrong" });
          expect(await wrong.initiateDeposit(deposit())).toEqual({ kind: "REJECTED", failureCode: "AUTHENTICATION_ERROR" });
          expect((await wrong.getDeposit(randomUUID())).kind).toBe("UNKNOWN");
        }
      }
    } finally {
      mock.authFailureStatus = 401;
      mock.authFailureShape = "sandbox";
    }
  });

  it("goes through pawaPay's in-between statuses as pending, and ignores answers about another payment or of absurd size", async () => {
    const a = adapter();
    const req = deposit();
    await a.initiateDeposit(req);
    mock.intermediateChecks = 2;
    try {
      expect(await a.getDeposit(req.depositId)).toEqual({ kind: "PENDING", providerStatus: "PROCESSING" });
      expect(await a.getDeposit(req.depositId)).toEqual({ kind: "PENDING", providerStatus: "IN_RECONCILIATION" });
      mock.faults.push({ method: "GET", pathPrefix: "/v2/deposits/", fault: "wrongId" });
      expect(await a.getDeposit(req.depositId)).toMatchObject({ kind: "UNKNOWN", reason: "status answer is for another deposit" });
      mock.faults.push({ method: "GET", pathPrefix: "/v2/deposits/", fault: "huge" });
      expect(await a.getDeposit(req.depositId)).toMatchObject({ kind: "UNKNOWN", reason: "network: response too large" });
      expect((await a.getDeposit(req.depositId)).kind).toBe("SUCCEEDED");
    } finally {
      mock.intermediateChecks = 0;
    }
  });

  it("reports an amount that is not a whole RWF value as unknown (finance exception), and cleans the wallet message", async () => {
    const a = adapter();
    const req = deposit({ customerMessage: "BeautyBOX order #BB-12!" });
    expect((await a.initiateDeposit(req)).kind).toBe("ACCEPTED"); // the imitation refuses invalid messages
    mock.reportedAmount.set(req.depositId, "12499.50");
    expect(await a.getDeposit(req.depositId)).toMatchObject({ kind: "SUCCEEDED", amountRwf: null });
    expect(wholeRwf("100.00")).toBe(100);
    expect(wholeRwf("100.50")).toBeNull();
    expect(walletMessage("BeautyBOX order #BB-12!")).toBe("BeautyBOX order BB 12");
    expect(walletMessage("!!")).toBeUndefined();
  });
});

describe("refunds", () => {
  it("one refund at a time per deposit, never more than paid, and only for a completed deposit (the sandbox's answers)", async () => {
    const a = adapter();
    const paid = deposit();
    await a.initiateDeposit(paid);
    await a.getDeposit(paid.depositId); // completes

    const first = { refundId: randomUUID(), depositId: paid.depositId, amountRwf: 5_000 };
    expect(await a.initiateRefund(first)).toEqual({ kind: "ACCEPTED", providerStatus: "ACCEPTED" });
    // Another refund while the first is processing (sandbox: INVALID_STATE "already in
    // progress"): nothing created, so "try again later" under the same id.
    const second = { refundId: randomUUID(), depositId: paid.depositId, amountRwf: 5_000 };
    expect(await a.initiateRefund(second)).toEqual({ kind: "UNKNOWN", reason: "rejected for now: INVALID_STATE", refusedForNow: "BUSY" });
    expect(await a.getRefund(second.refundId)).toEqual({ kind: "NOT_FOUND" });
    expect(await a.getRefund(first.refundId)).toMatchObject({ kind: "SUCCEEDED", providerStatus: "COMPLETED", amountRwf: 5_000 });
    expect(await a.initiateRefund(second)).toEqual({ kind: "ACCEPTED", providerStatus: "ACCEPTED" });
    await a.getRefund(second.refundId);

    // More than is left (sandbox: INVALID_AMOUNT), then everything refunded (INVALID_STATE
    // "already refunded"): definite refusals where pawaPay's record of the payment disagrees.
    expect(await a.initiateRefund({ refundId: randomUUID(), depositId: paid.depositId, amountRwf: 5_000 })).toEqual({ kind: "REJECTED", failureCode: "INVALID_AMOUNT", conflict: true });
    const rest = { refundId: randomUUID(), depositId: paid.depositId, amountRwf: 2_500 };
    expect((await a.initiateRefund(rest)).kind).toBe("ACCEPTED");
    await a.getRefund(rest.refundId);
    expect(await a.initiateRefund({ refundId: randomUUID(), depositId: paid.depositId, amountRwf: 100 })).toEqual({ kind: "REJECTED", failureCode: "INVALID_STATE", conflict: true });
    expect(await a.getRefund(first.refundId)).toMatchObject({ kind: "SUCCEEDED", currency: "RWF" });
    const pending = deposit({ payerMsisdn: "250783456129" });
    await a.initiateDeposit(pending);
    expect(await a.initiateRefund({ refundId: randomUUID(), depositId: pending.depositId, amountRwf: 100 })).toEqual({ kind: "REJECTED", failureCode: "DEPOSIT_NOT_COMPLETED", conflict: true });
    expect(await a.initiateRefund({ refundId: randomUUID(), depositId: randomUUID(), amountRwf: 100 })).toEqual({ kind: "REJECTED", failureCode: "NOT_FOUND", conflict: true });
  });

  it("access problems and outages are 'try again later' for refunds; other refusals are definite without a conflict", async () => {
    const a = adapter();
    const paid = deposit();
    await a.initiateDeposit(paid);
    await a.getDeposit(paid.depositId);
    const refund = () => ({ refundId: randomUUID(), depositId: paid.depositId, amountRwf: 100 });
    try {
      for (const shape of ["sandbox", "documented"] as const) {
        mock.authFailureShape = shape;
        expect(await adapter({ apiToken: "wrong" }).initiateRefund(refund())).toEqual({ kind: "UNKNOWN", reason: "rejected for now: AUTHENTICATION_ERROR", refusedForNow: "ACCESS" });
      }
    } finally {
      mock.authFailureShape = "sandbox";
    }
    for (const code of ["HTTP_SIGNATURE_ERROR", "REFUNDS_NOT_ALLOWED", "AUTHORISATION_ERROR"]) {
      mock.faults.push({ method: "POST", pathPrefix: "/v2/refunds", fault: `reject:${code}` });
      expect(await a.initiateRefund(refund())).toEqual({ kind: "UNKNOWN", reason: `rejected for now: ${code}`, refusedForNow: "ACCESS" });
    }
    mock.faults.push({ method: "POST", pathPrefix: "/v2/refunds", fault: "reject:PROVIDER_TEMPORARILY_UNAVAILABLE" });
    expect(await a.initiateRefund(refund())).toEqual({ kind: "UNKNOWN", reason: "rejected for now: PROVIDER_TEMPORARILY_UNAVAILABLE", refusedForNow: "UNAVAILABLE" });
    mock.faults.push({ method: "POST", pathPrefix: "/v2/refunds", fault: "reject:AMOUNT_OUT_OF_BOUNDS" });
    expect(await a.initiateRefund(refund())).toEqual({ kind: "REJECTED", failureCode: "AMOUNT_OUT_OF_BOUNDS" });
  });
});

describe("refund rejections in the documented code and the refunds guide's shape", () => {
  it("reads REFUND_IN_PROGRESS and rejectionReason.rejectionCode too, so a refund in progress is retried rather than failed", async () => {
    const a = adapter();
    const paid = deposit();
    await a.initiateDeposit(paid);
    await a.getDeposit(paid.depositId);
    mock.refundRejectionShape = "rejectionReason";
    try {
      expect((await a.initiateRefund({ refundId: randomUUID(), depositId: paid.depositId, amountRwf: 1_000 })).kind).toBe("ACCEPTED");
      expect(await a.initiateRefund({ refundId: randomUUID(), depositId: paid.depositId, amountRwf: 1_000 })).toMatchObject({ kind: "UNKNOWN", reason: "rejected for now: INVALID_STATE", refusedForNow: "BUSY" });
      mock.refundBusyCode = "REFUND_IN_PROGRESS";
      expect(await a.initiateRefund({ refundId: randomUUID(), depositId: paid.depositId, amountRwf: 1_000 })).toMatchObject({ kind: "UNKNOWN", reason: "rejected for now: REFUND_IN_PROGRESS", refusedForNow: "BUSY" });
      const pending = deposit({ payerMsisdn: "250783456129" });
      await a.initiateDeposit(pending);
      expect(await a.initiateRefund({ refundId: randomUUID(), depositId: pending.depositId, amountRwf: 100 })).toEqual({ kind: "REJECTED", failureCode: "DEPOSIT_NOT_COMPLETED", conflict: true });
    } finally {
      mock.refundRejectionShape = "failureReason";
      mock.refundBusyCode = "INVALID_STATE";
    }
  });

  it("an INVALID_STATE that does not say a refund is in progress stays a definite refusal", async () => {
    const a = adapter();
    const paid = deposit();
    await a.initiateDeposit(paid);
    await a.getDeposit(paid.depositId);
    mock.faults.push({ method: "POST", pathPrefix: "/v2/refunds", fault: "reject:INVALID_STATE" });
    expect(await a.initiateRefund({ refundId: randomUUID(), depositId: paid.depositId, amountRwf: 100 })).toEqual({ kind: "REJECTED", failureCode: "INVALID_STATE", conflict: true });
  });
});

describe("signed requests", () => {
  it("are refused without a signature once the account requires them, and accepted with one", async () => {
    const merchant = generateKeyPairSync("ec", { namedCurve: "P-256" });
    mock.merchantKey = { keyId: "BEAUTYBOX_KEY_1", publicKey: merchant.publicKey };
    try {
      expect(await adapter().initiateDeposit(deposit())).toEqual({ kind: "REJECTED", failureCode: "HTTP_SIGNATURE_ERROR" });
      // The private key as an environment file usually carries it: one line, escaped newlines.
      const pem = merchant.privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n");
      const signer = adapter({ signing: { keyId: "BEAUTYBOX_KEY_1", privateKeyPem: pem } });
      expect((await signer.initiateDeposit(deposit())).kind).toBe("ACCEPTED");
      expect(mock.requests.at(-1)).toMatchObject({ method: "POST", path: "/v2/deposits", signed: true });
      expect(await adapter({ signing: { keyId: "SOMEONE_ELSE", privateKeyPem: pem } }).initiateDeposit(deposit())).toEqual({ kind: "REJECTED", failureCode: "HTTP_SIGNATURE_ERROR" });
    } finally {
      mock.merchantKey = null;
    }
  });

  it("refuses a malformed or unsupported signing key at construction without echoing it", () => {
    const ed25519 = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => adapter({ signing: { keyId: "k", privateKeyPem: ed25519 } })).toThrow(/Unsupported signing key/);
    expect(() => adapter({ signing: { keyId: "k", privateKeyPem: "not-a-key-secret-material" } })).toThrow();
    try {
      adapter({ signing: { keyId: "k", privateKeyPem: "not-a-key-secret-material" } });
    } catch (error) {
      expect(String(error)).not.toContain("secret-material");
    }
  });
});

describe("callbacks", () => {
  const target = "https://shop.example/api/v1/callbacks/pawapay";
  const body = (id = randomUUID()) => ({ depositId: id, status: "COMPLETED", amount: "12500.00", currency: "RWF", country: "RWA", payer: { type: "MMO", accountDetails: { phoneNumber: "250783456789", provider: "MTN_MOMO_RWA" } }, created: new Date().toISOString() });
  const verify = (a: PawapayPaymentAdapter, signed: { rawBody: Buffer; headers: Headers }, url = target) => a.verifyCallback({ rawBody: signed.rawBody, headers: signed.headers, method: "POST", url });

  it("verifies a signed callback and reports what it claims", async () => {
    const a = adapter();
    const id = randomUUID();
    const result = await verify(a, mock.signedCallback(target, body(id)));
    expect(result).toMatchObject({ verified: true, signature: "VERIFIED", kind: "DEPOSIT", reference: id, claimedStatus: "COMPLETED" });
    const refundId = randomUUID();
    expect(await verify(a, mock.signedCallback(target, { refundId, status: "COMPLETED", amount: "100.00", currency: "RWF" }))).toMatchObject({ verified: true, kind: "REFUND", reference: refundId });
  });

  it("refuses unsigned, altered, re-targeted, stale and unknown-key callbacks", async () => {
    const a = adapter();
    const good = mock.signedCallback(target, body());
    const unsigned = { rawBody: good.rawBody, headers: new Headers({ "content-type": "application/json" }) };
    expect(await verify(a, unsigned)).toMatchObject({ verified: false, signature: "INVALID" });
    const altered = { rawBody: Buffer.from(good.rawBody.toString().replace("COMPLETED", "FAILED")), headers: good.headers };
    expect(await verify(a, altered)).toMatchObject({ verified: false, reason: "content digest does not match the body" });
    expect(await verify(a, good, "https://shop.example/api/v1/other")).toMatchObject({ verified: false, reason: "signature does not verify" });
    expect(await verify(a, good, "https://evil.example/api/v1/callbacks/pawapay")).toMatchObject({ verified: false, reason: "signature does not verify" });
    expect(await verify(a, mock.signedCallback(target, body(), { createdOffsetSeconds: -600 }))).toMatchObject({ verified: false, reason: "signature is not fresh" });
    expect(await verify(a, mock.signedCallback(target, body(), { keyId: "HTTP_EC_P256_KEY:999" }))).toMatchObject({ verified: false, signature: "UNKNOWN_KEY" });
  });

  it("picks up pawaPay's rotated key, but refreshes keys at most once a minute", async () => {
    let clock = Date.now();
    const a = adapter({ now: () => new Date(clock) });
    expect((await verify(a, mock.signedCallback(target, body()))).verified).toBe(true);
    mock.rotateKey();
    const rotated = mock.signedCallback(target, body());
    expect(await verify(a, rotated)).toMatchObject({ verified: false, signature: "UNKNOWN_KEY" }); // just refreshed
    clock += 61_000;
    expect((await verify(a, mock.signedCallback(target, body(), { createdOffsetSeconds: 61 }))).verified).toBe(true);
  });
});
