// pawaPay SANDBOX probe (I07, DR-042): runs the adapter against the real pawaPay sandbox with
// pawaPay's Rwanda test numbers, and records pawaPay's raw answers and timings for the points
// the docs leave open. Refuses anything but sandbox mode. Never prints the API token.
//   npx tsx --conditions=react-server --env-file=.env.local scripts/ops/pawapay-sandbox-probe.ts
//   ... pawapay-sandbox-probe.ts --deposit <id> --refund <id>   (only look up earlier ids)
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PAWAPAY_BASE_URLS, PawapayPaymentAdapter } from "@/adapters/payments/pawapay";
import { parsePrivateKey, signRequest } from "@/adapters/payments/http-signatures";

const MODE = process.env.PAWAPAY_MODE;
const TOKEN = process.env.PAWAPAY_API_TOKEN;
if (MODE !== "sandbox" || !TOKEN || process.env.PAWAPAY_BASE_URL) {
  console.error("This probe runs only with PAWAPAY_MODE=sandbox, a sandbox token and no PAWAPAY_BASE_URL.");
  process.exit(1);
}
const BASE = PAWAPAY_BASE_URLS.sandbox;
const RAW_TIMEOUT_MS = 30_000;
// Deposits and refunds are signed when a signing key is installed (the sandbox account then
// refuses unsigned ones); status checks and configuration reads need no signature.
const SIGNING =
  process.env.PAWAPAY_SIGNING_PRIVATE_KEY && process.env.PAWAPAY_SIGNING_KEY_ID ? { keyId: process.env.PAWAPAY_SIGNING_KEY_ID, privateKeyPem: process.env.PAWAPAY_SIGNING_PRIVATE_KEY } : undefined;
const adapter = new PawapayPaymentAdapter({ baseUrl: BASE, apiToken: TOKEN, signing: SIGNING });
const record: Record<string, unknown> = { at: new Date().toISOString(), base: BASE, signsRequests: Boolean(SIGNING) };
const CONTENT_TYPE = "application/json; charset=UTF-8";

async function raw(method: "GET" | "POST", p: string, body?: unknown, token = TOKEN!, sign = true) {
  const started = performance.now();
  const url = `${BASE}${p}`;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const signature =
    SIGNING && sign && method === "POST" && payload !== undefined
      ? signRequest({ method, url, body: payload, contentType: CONTENT_TYPE, keyId: SIGNING.keyId, privateKey: parsePrivateKey(SIGNING.privateKeyPem), now: new Date() })
      : {};
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": CONTENT_TYPE, Accept: "application/json", ...signature },
      body: payload,
      signal: AbortSignal.timeout(RAW_TIMEOUT_MS),
    });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // keep text
    }
    return { status: res.status, ms: Math.round(performance.now() - started), body: json };
  } catch (error) {
    return { status: 0, ms: Math.round(performance.now() - started), error: error instanceof Error ? error.name : "unknown" };
  }
}

/** Runs an adapter call and records how long it took. */
async function timed<T>(fn: () => Promise<T>): Promise<T & { ms: number }> {
  const started = performance.now();
  const result = await fn();
  return { ...result, ms: Math.round(performance.now() - started) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (label: string, value: unknown) => {
  record[label] = value;
  console.log(`\n# ${label}\n${JSON.stringify(value, null, 1).slice(0, 1500)}`);
};

async function pollDeposit(id: string, seconds: number) {
  const seen: string[] = [];
  for (let i = 0; i < seconds / 3; i++) {
    const s = await adapter.getDeposit(id);
    seen.push(s.kind === "PENDING" ? `PENDING:${s.providerStatus}` : s.kind);
    if (s.kind === "SUCCEEDED" || s.kind === "FAILED") return { final: s, seen };
    await sleep(3000);
  }
  return { final: await adapter.getDeposit(id), seen };
}

async function pollRefund(id: string, seconds: number) {
  const seen: string[] = [];
  for (let i = 0; i < seconds / 3; i++) {
    const s = await adapter.getRefund(id);
    seen.push(s.kind === "PENDING" ? `PENDING:${s.providerStatus}` : s.kind);
    if (s.kind === "SUCCEEDED" || s.kind === "FAILED") return { final: s, seen };
    await sleep(3000);
  }
  return { final: await adapter.getRefund(id), seen };
}

function depositRequest(msisdn: string, method: "MTN_MOMO_RWA" | "AIRTEL_RWA", amountRwf = 1000) {
  return { depositId: randomUUID(), amountRwf, method, payerMsisdn: msisdn, customerMessage: "BeautyBOX sandbox", clientReference: `BB-PROBE-${Date.now()}` };
}

/** Initiates a deposit; after an unknown outcome, looks it up and re-sends under the same id, as the app does. */
async function initiate(req: ReturnType<typeof depositRequest>) {
  const tries: unknown[] = [];
  for (let i = 0; i < 3; i++) {
    const init = await timed(() => adapter.initiateDeposit(req));
    tries.push(init);
    if (init.kind !== "UNKNOWN") break;
    const found = await timed(() => adapter.getDeposit(req.depositId));
    tries.push({ lookup: found });
    if (found.kind !== "NOT_FOUND" && found.kind !== "UNKNOWN") break;
  }
  return tries;
}

function refundableAfter(accepted: boolean[], amounts: number[], paid: number) {
  return paid - amounts.reduce((sum, amount, i) => sum + (accepted[i] ? amount : 0), 0);
}

async function lookups(args: string[]) {
  for (let i = 0; i < args.length; i += 2) {
    const [flag, id] = [args[i], args[i + 1]];
    if (flag === "--deposit") log(`deposit ${id}`, await raw("GET", `/v2/deposits/${id}`));
    else if (flag === "--refund") log(`refund ${id}`, await raw("GET", `/v2/refunds/${id}`));
    else throw new Error(`unknown flag ${flag}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    await lookups(args);
  } else {
    await probe();
  }
  const out = path.resolve(process.cwd(), ".local", `pawapay-sandbox-probe-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(record, null, 2));
  console.log(`\nSaved: ${out}`);
}

async function probe() {
  // 1. Configuration and keys
  const conf = await raw("GET", "/v2/active-conf?country=RWA&operationType=DEPOSIT");
  const confBody = conf.body as { signatureConfiguration?: unknown; countries?: { country: string; providers: { provider: string; currencies: { currency: string; operationTypes: Record<string, unknown> }[] }[] }[] };
  log("active-conf", {
    status: conf.status,
    ms: conf.ms,
    signatureConfiguration: confBody?.signatureConfiguration,
    rwanda: confBody?.countries?.find((c) => c.country === "RWA")?.providers.map((p) => ({ provider: p.provider, currencies: p.currencies.map((c) => ({ currency: c.currency, operationTypes: c.operationTypes })) })),
  });
  log("adapter.getEnabledMethods", await timed(() => adapter.getEnabledMethods()));
  const keys = await raw("GET", "/v2/public-key/http");
  log("public-keys", { status: keys.status, ms: keys.ms, ids: Array.isArray(keys.body) ? (keys.body as { id: string }[]).map((k) => k.id) : keys.body });

  // 2. A successful deposit, its duplicate, and the raw status shape
  const ok = depositRequest("250783456789", "MTN_MOMO_RWA");
  log("deposit success: initiate", { depositId: ok.depositId, tries: await initiate(ok) });
  log("deposit success: duplicate", await timed(() => adapter.initiateDeposit(ok)));
  const okResult = await pollDeposit(ok.depositId, 60);
  log("deposit success: statuses seen and final", okResult);
  log("deposit success: raw status", await raw("GET", `/v2/deposits/${ok.depositId}`));

  // 3. Other test numbers, including a payment that never settles
  for (const [label, msisdn, method] of [
    ["Airtel completes (250733456789)", "250733456789", "AIRTEL_RWA"],
    ["MTN not approved (250783456039)", "250783456039", "MTN_MOMO_RWA"],
    ["Airtel insufficient balance (250733456049)", "250733456049", "AIRTEL_RWA"],
    ["MTN never final (250783456129)", "250783456129", "MTN_MOMO_RWA"],
  ] as const) {
    const req = depositRequest(msisdn, method);
    const tries = await initiate(req);
    const polled = await pollDeposit(req.depositId, label.includes("never") ? 30 : 60);
    log(`deposit ${label}`, { depositId: req.depositId, tries, ...polled });
    if (label.includes("not approved")) record.failedDepositId = req.depositId;
  }
  log("deposit unknown id", await timed(() => adapter.getDeposit(randomUUID())));

  // 4. Refusals: raw shapes
  const payer = { type: "MMO", accountDetails: { phoneNumber: "250783456789", provider: "MTN_MOMO_RWA" } };
  log("raw: decimal amount", await raw("POST", "/v2/deposits", { depositId: randomUUID(), amount: "100.5", currency: "RWF", payer }));
  log("raw: amount out of bounds", await raw("POST", "/v2/deposits", { depositId: randomUUID(), amount: "999999999", currency: "RWF", payer }));
  log("raw: unsupported parameter", await raw("POST", "/v2/deposits", { depositId: randomUUID(), amount: "100", currency: "RWF", amnt: "1", payer }));
  log("raw: bad token (status check)", await raw("GET", `/v2/deposits/${ok.depositId}`, undefined, "not-a-valid-token"));
  if (SIGNING) log("raw: unsigned deposit while signing is installed", await raw("POST", "/v2/deposits", { depositId: randomUUID(), amount: "100", currency: "RWF", payer }, TOKEN!, false));

  // 5. Refunds on the completed deposit (1000 RWF): 400, a second straight after (in progress?),
  //    one above what is left, the exact remainder, then one after the full amount is refunded.
  if (okResult.final.kind === "SUCCEEDED") {
    const r1 = { refundId: randomUUID(), depositId: ok.depositId, amountRwf: 400 };
    const r1Init = await timed(() => adapter.initiateRefund(r1));
    log("refund 400: initiate", { refundId: r1.refundId, ...r1Init });
    const second = await raw("POST", "/v2/refunds", { refundId: randomUUID(), depositId: ok.depositId, amount: "300", currency: "RWF" });
    log("raw: second refund of 300 straight after", second);
    log("refund 400: statuses seen and final", await pollRefund(r1.refundId, 60));
    log("raw: refund 400 status", await raw("GET", `/v2/refunds/${r1.refundId}`));
    const secondAccepted = (second.body as { status?: string } | undefined)?.status === "ACCEPTED";
    if (secondAccepted) {
      const secondId = (second.body as { refundId: string }).refundId;
      log("refund 300: statuses seen and final", await pollRefund(secondId, 60));
    }
    const left = refundableAfter([r1Init.kind === "ACCEPTED", secondAccepted], [400, 300], 1000);
    log("raw: refund above what is left", { left, ...(await raw("POST", "/v2/refunds", { refundId: randomUUID(), depositId: ok.depositId, amount: String(left + 100), currency: "RWF" })) });
    const r2 = { refundId: randomUUID(), depositId: ok.depositId, amountRwf: left };
    log("refund remainder: initiate", { refundId: r2.refundId, amount: left, ...(await timed(() => adapter.initiateRefund(r2))) });
    log("refund remainder: final", await pollRefund(r2.refundId, 60));
    log("raw: refund after full refund", await raw("POST", "/v2/refunds", { refundId: randomUUID(), depositId: ok.depositId, amount: "100", currency: "RWF" }));
  }
  if (typeof record.failedDepositId === "string") {
    log("raw: refund of a failed deposit", await raw("POST", "/v2/refunds", { refundId: randomUUID(), depositId: record.failedDepositId, amount: "100", currency: "RWF" }));
  }
}

main().catch((error) => {
  console.error("probe failed:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
