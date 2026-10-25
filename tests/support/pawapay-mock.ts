import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  contentDigest,
  contentDigestMatches,
  parseSignature,
  parseSignatureInput,
  signatureBase,
  signBase,
  verifyBase,
} from "@/adapters/payments/http-signatures";

// A local imitation of the pawaPay Merchant API v2 for tests (DR-042), following the docs
// (docs.pawapay.io/v2, reviewed 2026-10-24): bearer tokens, optional enforced request
// signatures, depositId/refundId idempotency (DUPLICATE_IGNORED), FOUND/NOT_FOUND status
// checks, the Rwanda sandbox test numbers, refund rules (deposit must be COMPLETED, one
// refund at a time, never more than paid), active configuration, public keys, signed
// callbacks, and fault injection. It never talks to pawaPay.

type Txn = { id: string; kind: "deposit" | "refund"; status: string; amount: number; currency: string; phone: string; provider: string; created: string; failureCode?: string; depositId?: string; checks: number };

// Rwanda sandbox numbers (docs v2 test_numbers) and what they lead to. The "never final"
// numbers are documented as SUBMITTED; any non-final status is pending for the adapter.
const DEPOSIT_OUTCOMES: Record<string, { status: "COMPLETED" | "FAILED" | "PROCESSING"; failureCode?: string }> = {
  "250783456789": { status: "COMPLETED" },
  "250783456019": { status: "FAILED", failureCode: "PAYER_LIMIT_REACHED" },
  "250783456029": { status: "FAILED", failureCode: "PAYER_NOT_FOUND" },
  "250783456039": { status: "FAILED", failureCode: "PAYMENT_NOT_APPROVED" },
  "250783456069": { status: "FAILED", failureCode: "UNSPECIFIED_FAILURE" },
  "250783456129": { status: "PROCESSING" },
  "250733456789": { status: "COMPLETED" },
  "250733456039": { status: "FAILED", failureCode: "PAYMENT_NOT_APPROVED" },
  "250733456049": { status: "FAILED", failureCode: "INSUFFICIENT_BALANCE" },
  "250733456069": { status: "FAILED", failureCode: "UNSPECIFIED_FAILURE" },
  "250733456129": { status: "PROCESSING" },
};

/** One-off faults. `reject:<CODE>` answers 200 REJECTED with that code; `reject:` with no reason. */
export type Fault = "http500" | "dropAfterAccept" | "hang" | "wrongId" | "huge" | `reject:${string}`;

export type PawapayMock = {
  url: string;
  token: string;
  keyId: string;
  deposits: Map<string, Txn>;
  refunds: Map<string, Txn>;
  requests: { method: string; path: string; signed: boolean }[];
  /** The next matching request fails this way (once per entry). */
  faults: { method: string; pathPrefix: string; fault: Fault }[];
  closedProviders: Set<string>;
  /** When set, POSTs to /v2/deposits and /v2/refunds must be signed with this key. */
  merchantKey: { keyId: string; publicKey: KeyObject } | null;
  /** Amount pawaPay reports for a completed deposit or refund, when it should differ. */
  reportedAmount: Map<string, string>;
  /** Status checks that answer PROCESSING, then IN_RECONCILIATION, before the final status. */
  intermediateChecks: number;
  /** HTTP status for authentication and signature failures (the docs say 401 in one place, 403 in another). */
  authFailureStatus: 401 | 403;
  /** Body of those failures: the sandbox's (only failureReason, seen 2026-10-24) or the documented one (also status REJECTED). */
  authFailureShape: "sandbox" | "documented";
  /** Refund initiation rejections in the reference shape (failureReason) or the guide's (rejectionReason). */
  refundRejectionShape: "failureReason" | "rejectionReason";
  /** Code for a refund sent while another is processing: the sandbox's INVALID_STATE (seen 2026-10-24) or the documented REFUND_IN_PROGRESS. */
  refundBusyCode: "INVALID_STATE" | "REFUND_IN_PROGRESS";
  rotateKey(): void;
  signedCallback(target: string, body: unknown, options?: { createdOffsetSeconds?: number; keyId?: string }): { rawBody: Buffer; headers: Headers };
  close(): Promise<void>;
};

export async function startPawapayMock(options: { token?: string } = {}): Promise<PawapayMock> {
  const token = options.token ?? `mock-token-${randomUUID()}`;
  let keyVersion = 1;
  let pawapayKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const keys = new Map<string, KeyObject>([[`HTTP_EC_P256_KEY:${keyVersion}`, pawapayKeys.publicKey]]);

  const mock: PawapayMock = {
    url: "",
    token,
    keyId: `HTTP_EC_P256_KEY:${keyVersion}`,
    deposits: new Map(),
    refunds: new Map(),
    requests: [],
    faults: [],
    closedProviders: new Set(),
    merchantKey: null,
    reportedAmount: new Map(),
    intermediateChecks: 0,
    authFailureStatus: 401,
    authFailureShape: "sandbox",
    refundRejectionShape: "failureReason",
    refundBusyCode: "INVALID_STATE",
    rotateKey() {
      keyVersion++;
      pawapayKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
      mock.keyId = `HTTP_EC_P256_KEY:${keyVersion}`;
      keys.clear();
      keys.set(mock.keyId, pawapayKeys.publicKey);
    },
    signedCallback(target, body, opts = {}) {
      const rawBody = Buffer.from(JSON.stringify(body));
      const created = Math.floor(Date.now() / 1000) + (opts.createdOffsetSeconds ?? 0);
      const headers = new Headers({
        "content-type": "application/json; charset=UTF-8",
        "content-digest": contentDigest(rawBody, "sha-512"),
        "signature-date": new Date(created * 1000).toISOString(),
      });
      const raw = `("@method" "@authority" "@path" "signature-date" "content-digest" "content-type");alg="ecdsa-p256-sha256";keyid="${opts.keyId ?? mock.keyId}";created=${created};expires=${created + 60}`;
      const base = signatureBase({ method: "POST", url: target, headers }, { components: ["@method", "@authority", "@path", "signature-date", "content-digest", "content-type"], raw })!;
      headers.set("signature-input", `sig-pp=${raw}`);
      headers.set("signature", `sig-pp=:${signBase(base, "ecdsa-p256-sha256", pawapayKeys.privateKey).toString("base64")}:`);
      return { rawBody, headers };
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections(); // includes deliberately hung requests
        server.close(() => resolve());
      }),
  };

  const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const json = sendJson;

  function txnView(t: Txn) {
    const amount = mock.reportedAmount.get(t.id) ?? `${t.amount}.00`;
    const party = { type: "MMO", accountDetails: { phoneNumber: t.phone, provider: t.provider } };
    return {
      [t.kind === "deposit" ? "depositId" : "refundId"]: t.id,
      status: t.status,
      amount,
      currency: t.currency,
      country: "RWA",
      [t.kind === "deposit" ? "payer" : "recipient"]: party,
      created: t.created,
      ...(t.status === "COMPLETED" ? { providerTransactionId: `MOCK-${t.id.slice(0, 8)}` } : {}),
      ...(t.status === "FAILED" ? { failureReason: { failureCode: t.failureCode ?? "UNSPECIFIED_FAILURE", failureMessage: "mock failure" } } : {}),
    };
  }

  function advance(t: Txn) {
    // A status check moves an accepted payment on, as time would.
    t.checks++;
    if (!["ACCEPTED", "ENQUEUED", "PROCESSING", "IN_RECONCILIATION"].includes(t.status)) return;
    if (t.checks <= mock.intermediateChecks) {
      t.status = t.checks === mock.intermediateChecks && t.checks > 1 ? "IN_RECONCILIATION" : "PROCESSING";
      return;
    }
    if (t.status === "PROCESSING" && DEPOSIT_OUTCOMES[t.phone]?.status === "PROCESSING" && t.kind === "deposit") return;
    if (t.kind === "refund") {
      t.status = "COMPLETED";
      return;
    }
    const outcome = DEPOSIT_OUTCOMES[t.phone] ?? { status: "COMPLETED" as const };
    t.status = outcome.status;
    if (outcome.failureCode) t.failureCode = outcome.failureCode;
  }

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url ?? "/", mock.url);
      const method = req.method ?? "GET";
      const signed = Boolean(req.headers["signature"]);
      mock.requests.push({ method, path: url.pathname, signed });

      const faultIndex = mock.faults.findIndex((f) => f.method === method && url.pathname.startsWith(f.pathPrefix));
      const fault = faultIndex >= 0 ? mock.faults.splice(faultIndex, 1)[0]!.fault : null;
      if (fault === "hang") return; // never answers: the client's timeout must fire
      if (fault === "http500") return json(res, 500, { failureReason: { failureCode: "UNKNOWN_ERROR", failureMessage: "Unable to process request due to an unknown problem." } });
      if (fault === "huge") return json(res, 200, { status: "FOUND", padding: "x".repeat(2_000_000) });
      if (fault?.startsWith("reject:")) {
        const code = fault.slice("reject:".length);
        return json(res, 200, { status: "REJECTED", ...(code ? { failureReason: { failureCode: code, failureMessage: "mock rejection" } } : {}) });
      }

      const accessRefused = (failureCode: string, failureMessage: string) =>
        json(res, mock.authFailureStatus, { ...(mock.authFailureShape === "documented" ? { status: "REJECTED" } : {}), failureReason: { failureCode, failureMessage } });
      if (req.headers.authorization !== `Bearer ${token}`) return accessRefused("AUTHENTICATION_ERROR", "The API token in the request is invalid.");

      if (method === "POST" && mock.merchantKey && (url.pathname === "/v2/deposits" || url.pathname === "/v2/refunds")) {
        const headers = new Headers(Object.entries(req.headers).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])));
        const input = parseSignatureInput(headers.get("signature-input")).find((s) => s.label === "sig-pp");
        const signature = parseSignature(headers.get("signature")).get("sig-pp");
        const base = input ? signatureBase({ method, url: url.toString(), headers }, input) : null;
        const created = input && typeof input.params.created === "number" ? input.params.created : 0;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const ok =
          input !== undefined &&
          signature !== undefined &&
          base !== null &&
          // The components the docs recommend, and a current signature.
          ["@method", "@authority", "@path", "signature-date", "content-digest", "content-type"].every((c) => input.components.includes(c)) &&
          Math.abs(nowSeconds - created) <= 300 &&
          input.params.keyid === mock.merchantKey.keyId &&
          contentDigestMatches(headers.get("content-digest"), raw) &&
          verifyBase(base, signature, String(input.params.alg), mock.merchantKey.publicKey);
        if (!ok) return accessRefused("HTTP_SIGNATURE_ERROR", "signature could not be verified");
      }

      let body: Record<string, unknown> = {};
      try {
        body = raw.length ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {};
      } catch {
        return json(res, 400, { status: "REJECTED", failureReason: { failureCode: "INVALID_INPUT", failureMessage: "unparseable" } });
      }

      if (method === "GET" && url.pathname === "/v2/public-key/http") {
        return json(res, 200, [...keys].map(([id, key]) => ({ id, key: key.export({ type: "spki", format: "pem" }).toString() })));
      }

      if (method === "GET" && url.pathname === "/v2/active-conf") {
        const provider = (p: string, name: string) => ({
          provider: p,
          displayName: name,
          nameDisplayedToCustomer: name,
          logo: "https://example.test/logo.png",
          currencies: [{ currency: "RWF", displayName: "R₣", operationTypes: { DEPOSIT: { authType: "PROVIDER_AUTH", pinPrompt: "AUTOMATIC", minAmount: "100", maxAmount: "5000000", decimalsInAmount: "NONE", status: mock.closedProviders.has(p) ? "CLOSED" : "OPERATIONAL" } } }],
        });
        return json(res, 200, {
          companyName: "BeautyBOX test",
          signatureConfiguration: { signedRequestsOnly: Boolean(mock.merchantKey), signedCallbacks: true },
          countries: [{ country: "RWA", displayName: { en: "Rwanda", fr: "Rwanda" }, prefix: "250", flag: "", providers: [provider("MTN_MOMO_RWA", "MTN"), provider("AIRTEL_RWA", "Airtel")] }],
        });
      }

      if (method === "POST" && url.pathname === "/v2/deposits") {
        const id = String(body.depositId ?? "");
        const payer = body.payer as { type?: string; accountDetails?: { phoneNumber?: string; provider?: string } } | undefined;
        const allowed = new Set(["depositId", "amount", "currency", "payer", "clientReferenceId", "customerMessage", "metadata", "preAuthorisationCode"]);
        const extra = Object.keys(body).find((k) => !allowed.has(k));
        if (extra) return json(res, 400, { depositId: id, status: "REJECTED", failureReason: { failureCode: "UNSUPPORTED_PARAMETER", failureMessage: `Request includes an unsupported parameter '${extra}'` } });
        if (!/^[0-9a-f-]{36}$/.test(id) || !payer?.accountDetails?.phoneNumber || !payer.accountDetails.provider || payer.type !== "MMO") {
          return json(res, 400, { depositId: id, status: "REJECTED", failureReason: { failureCode: "MISSING_PARAMETER", failureMessage: "missing" } });
        }
        if (mock.deposits.has(id)) return json(res, 200, { depositId: id, status: "DUPLICATE_IGNORED", created: mock.deposits.get(id)!.created });
        const amount = String(body.amount ?? "");
        if (!/^[1-9]\d*$/.test(amount)) return json(res, 200, { depositId: id, status: "REJECTED", failureReason: { failureCode: "INVALID_AMOUNT", failureMessage: "no decimals for RWF" } });
        if (Number(amount) > 5_000_000) return json(res, 200, { depositId: id, status: "REJECTED", failureReason: { failureCode: "AMOUNT_OUT_OF_BOUNDS", failureMessage: "too large" } });
        if (body.currency !== "RWF") return json(res, 200, { depositId: id, status: "REJECTED", failureReason: { failureCode: "INVALID_CURRENCY", failureMessage: "RWF only" } });
        if (mock.closedProviders.has(payer.accountDetails.provider)) {
          return json(res, 200, { depositId: id, status: "REJECTED", failureReason: { failureCode: "PROVIDER_TEMPORARILY_UNAVAILABLE", failureMessage: "outage" } });
        }
        if (body.customerMessage !== undefined && !/^[a-zA-Z0-9 ]{4,22}$/.test(String(body.customerMessage))) {
          return json(res, 400, { depositId: id, status: "REJECTED", failureReason: { failureCode: "INVALID_PARAMETER", failureMessage: "customerMessage" } });
        }
        const created = new Date().toISOString();
        mock.deposits.set(id, { id, kind: "deposit", status: "ACCEPTED", amount: Number(amount), currency: "RWF", phone: payer.accountDetails.phoneNumber, provider: payer.accountDetails.provider, created, checks: 0 });
        if (fault === "dropAfterAccept") return req.socket.destroy(); // accepted, but the answer never arrives
        return json(res, 200, { depositId: id, status: "ACCEPTED", created, nextStep: "FINAL_STATUS" });
      }

      if (method === "POST" && url.pathname === "/v2/refunds") {
        const id = String(body.refundId ?? "");
        const depositId = String(body.depositId ?? "");
        const json = (r: http.ServerResponse, status: number, payload: Record<string, unknown>) => {
          // The refunds guide shows rejections as rejectionReason.rejectionCode.
          if (mock.refundRejectionShape === "rejectionReason" && payload.status === "REJECTED" && payload.failureReason) {
            const { failureCode, failureMessage } = payload.failureReason as { failureCode: string; failureMessage: string };
            const { failureReason: _drop, ...rest } = payload;
            return sendJson(r, status, { ...rest, rejectionReason: { rejectionCode: failureCode, rejectionMessage: failureMessage } });
          }
          return sendJson(r, status, payload);
        };
        if (mock.refunds.has(id)) return json(res, 200, { refundId: id, status: "DUPLICATE_IGNORED", created: mock.refunds.get(id)!.created });
        const deposit = mock.deposits.get(depositId);
        if (!deposit) return json(res, 200, { refundId: id, status: "REJECTED", failureReason: { failureCode: "NOT_FOUND", failureMessage: "deposit not found" } });
        // Codes and wording as the sandbox answered them on 2026-10-24 (DR-043).
        if (deposit.status !== "COMPLETED") return json(res, 200, { refundId: id, status: "REJECTED", failureReason: { failureCode: "DEPOSIT_NOT_COMPLETED", failureMessage: "Requested deposit status must be COMPLETED" } });
        const forDeposit = [...mock.refunds.values()].filter((r) => r.depositId === depositId);
        if (forDeposit.some((r) => r.status !== "COMPLETED" && r.status !== "FAILED")) {
          return json(res, 200, { refundId: id, status: "REJECTED", failureReason: { failureCode: mock.refundBusyCode, failureMessage: "A refund is already in progress for this deposit." } });
        }
        const refunded = forDeposit.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + r.amount, 0);
        const amount = body.amount === undefined ? deposit.amount - refunded : Number(body.amount);
        if (refunded >= deposit.amount) return json(res, 200, { refundId: id, status: "REJECTED", failureReason: { failureCode: "INVALID_STATE", failureMessage: "Requested deposit has been already refunded" } });
        if (amount > deposit.amount - refunded) {
          return json(res, 200, { refundId: id, status: "REJECTED", failureReason: { failureCode: "INVALID_AMOUNT", failureMessage: `The requested refund amount '${amount}' is more than the refundable part of the original deposit '${deposit.amount - refunded}'` } });
        }
        const created = new Date().toISOString();
        mock.refunds.set(id, { id, kind: "refund", status: "ACCEPTED", amount, currency: "RWF", phone: deposit.phone, provider: deposit.provider, created, depositId, checks: 0 });
        if (fault === "dropAfterAccept") return req.socket.destroy();
        return json(res, 200, { refundId: id, status: "ACCEPTED", created });
      }

      const status = /^\/v2\/(deposits|refunds)\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (method === "GET" && status) {
        const t = (status[1] === "deposits" ? mock.deposits : mock.refunds).get(status[2]!);
        if (!t) return json(res, 200, { status: "NOT_FOUND" });
        advance(t);
        const data: Record<string, unknown> = txnView(t);
        if (fault === "wrongId") data[t.kind === "deposit" ? "depositId" : "refundId"] = randomUUID();
        return json(res, 200, { status: "FOUND", data });
      }

      return json(res, 404, { failureReason: { failureCode: "NOT_FOUND", failureMessage: "no such endpoint in the mock" } });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return mock;
}
