import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { serverEnv } from "@/server/env";
import { addSeconds, now } from "@/modules/shared/clock";
import { constantTimeEqual, sha256Hex } from "@/server/crypto";
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

// FAKE payment provider for local development and tests (I06). It behaves like an
// asynchronous mobile-money collector with its own persistent state (devsim schema):
// initiation acceptance is not completion, completion arrives later, responses can be
// lost after the provider recorded the deposit, and duplicate submissions of the same
// depositId are ignored. It can never run in production (env validation rejects it).
//
// Payer test numbers choose the scenario by their last three digits:
export const FAKE_SCENARIOS = {
  "001": { scenario: "FAIL", label: "Payment fails (insufficient balance)" },
  "002": { scenario: "NEVER_SETTLES", label: "Stays pending (unresolved)" },
  "003": { scenario: "REJECT", label: "Rejected at initiation" },
  "004": { scenario: "LOST_RESPONSE", label: "Accepted, response lost, then succeeds" },
  "006": { scenario: "AMOUNT_MISMATCH", label: "Succeeds with a different amount" },
  "007": { scenario: "SLOW_SUCCESS", label: "Succeeds after about 45 seconds" },
} as const;
const DEFAULT_SCENARIO = { scenario: "SUCCESS", label: "Succeeds after a few seconds" };

export const FAKE_SETTLE_SECONDS = 4;
const SLOW_SETTLE_SECONDS = 45;

export function fakeScenarioFor(msisdn: string) {
  return FAKE_SCENARIOS[msisdn.slice(-3) as keyof typeof FAKE_SCENARIOS] ?? DEFAULT_SCENARIO;
}

type DepositRow = {
  deposit_id: string;
  amount: string;
  currency: string;
  scenario: string;
  created_at: Date;
  settles_at: Date | null;
  final_status: string | null;
  failure_code: string | null;
  transaction_id: string | null;
};

export class FakePaymentAdapter implements PaymentAdapter {
  readonly provider = "FAKE" as const;

  async getEnabledMethods(): Promise<EnabledMethods> {
    const rows = await db().$queryRaw<{ enabled_methods: string[] }[]>`SELECT enabled_methods FROM devsim.settings WHERE id = 1`;
    const methods = (rows[0]?.enabled_methods ?? []).filter(
      (m): m is PaymentMethodCode => m === "MTN_MOMO_RWA" || m === "AIRTEL_RWA",
    );
    return { methods, healthy: true };
  }

  async initiateDeposit(request: DepositRequest): Promise<InitiationResult> {
    const { scenario } = fakeScenarioFor(request.payerMsisdn);
    if (scenario === "REJECT") return { kind: "REJECTED", failureCode: "PAYMENT_NOT_APPROVED" };
    const at = now();
    const settleAfter = scenario === "SLOW_SUCCESS" ? SLOW_SETTLE_SECONDS : FAKE_SETTLE_SECONDS;
    const inserted = await db().$executeRaw`
      INSERT INTO devsim.deposits (deposit_id, amount, currency, provider, msisdn_hash, scenario, created_at, settles_at)
      VALUES (${request.depositId}::uuid, ${String(request.amountRwf)}, 'RWF', ${request.method},
              ${sha256Hex(request.payerMsisdn)}, ${scenario}, ${at},
              ${scenario === "NEVER_SETTLES" ? null : addSeconds(at, settleAfter)})
      ON CONFLICT (deposit_id) DO NOTHING`;
    if (inserted === 0) return { kind: "DUPLICATE", providerStatus: "DUPLICATE_IGNORED" };
    if (scenario === "LOST_RESPONSE") {
      // The provider recorded the deposit, but the response never reaches BeautyBOX.
      return { kind: "UNKNOWN", reason: "simulated connection drop after acceptance" };
    }
    return { kind: "ACCEPTED", providerStatus: "ACCEPTED" };
  }

  async getDeposit(depositId: string): Promise<DepositStatus> {
    const rows = await db().$queryRaw<DepositRow[]>`
      SELECT deposit_id, amount, currency, scenario, created_at, settles_at, final_status, failure_code, transaction_id
        FROM devsim.deposits WHERE deposit_id = ${depositId}::uuid`;
    const row = rows[0];
    if (!row) return { kind: "NOT_FOUND" };
    const settled = await this.settleIfDue(row);
    const evidence = { ref: `devsim:deposit:${row.deposit_id}`, observedAt: now().toISOString() };
    if (settled.final_status === "COMPLETED") {
      const amount = Number(settled.amount);
      return {
        kind: "SUCCEEDED",
        providerStatus: "COMPLETED",
        amountRwf: Number.isSafeInteger(amount) ? amount : null,
        currency: settled.currency,
        providerTransactionId: settled.transaction_id,
        evidence,
      };
    }
    if (settled.final_status === "FAILED") {
      return { kind: "FAILED", providerStatus: "FAILED", failureCode: settled.failure_code ?? "UNKNOWN_ERROR", evidence };
    }
    return { kind: "PENDING", providerStatus: "PROCESSING" };
  }

  private async settleIfDue(row: DepositRow): Promise<DepositRow> {
    if (row.final_status || !row.settles_at || row.settles_at > now()) return row;
    const fail = row.scenario === "FAIL";
    const amount = row.scenario === "AMOUNT_MISMATCH" ? String(Number(row.amount) + 100) : row.amount;
    const finalStatus = fail ? "FAILED" : "COMPLETED";
    const failureCode = fail ? "PAYER_LIMIT_REACHED" : null;
    const transactionId = fail ? null : `devsim-${randomUUID()}`;
    await db().$executeRaw`
      UPDATE devsim.deposits
         SET final_status = ${finalStatus}, failure_code = ${failureCode}, transaction_id = ${transactionId}, amount = ${amount}
       WHERE deposit_id = ${row.deposit_id}::uuid AND final_status IS NULL`;
    const rows = await db().$queryRaw<DepositRow[]>`
      SELECT deposit_id, amount, currency, scenario, created_at, settles_at, final_status, failure_code, transaction_id
        FROM devsim.deposits WHERE deposit_id = ${row.deposit_id}::uuid`;
    return rows[0]!;
  }

  // Simulated callbacks are authenticated with a local-only HMAC. This is NOT the
  // pawaPay scheme (which uses signed HTTP messages verified with provider public
  // keys, implemented in I07) and is accepted only by this fake adapter.
  static simulatedSignature(rawBody: Buffer): string {
    return createHmac("sha256", `devsim-callback:${serverEnv().WORKER_SECRET}`).update(rawBody).digest("base64url");
  }

  async verifyCallback(request: CallbackRequest): Promise<CallbackVerification> {
    const eventHash = sha256Hex(request.rawBody);
    const signature = request.headers.get("x-devsim-signature") ?? "";
    if (!signature || !constantTimeEqual(signature, FakePaymentAdapter.simulatedSignature(request.rawBody))) {
      return { verified: false, signature: "INVALID", reason: "simulated signature mismatch", eventHash };
    }
    let body: unknown;
    try {
      body = JSON.parse(request.rawBody.toString("utf8"));
    } catch {
      return { verified: false, signature: "INVALID", reason: "malformed body", eventHash };
    }
    const b = body as { depositId?: unknown; refundId?: unknown; status?: unknown };
    const reference = typeof b.depositId === "string" ? b.depositId : typeof b.refundId === "string" ? b.refundId : null;
    if (!reference) return { verified: false, signature: "INVALID", reason: "missing reference", eventHash };
    return {
      verified: true,
      signature: "SIMULATED",
      kind: typeof b.refundId === "string" ? "REFUND" : "DEPOSIT",
      reference,
      claimedStatus: typeof b.status === "string" ? b.status : null,
      eventHash,
    };
  }

  async initiateRefund(request: RefundRequest): Promise<InitiationResult> {
    const at = now();
    const inserted = await db().$executeRaw`
      INSERT INTO devsim.refunds (refund_id, deposit_id, amount, currency, created_at, settles_at)
      VALUES (${request.refundId}::uuid, ${request.depositId}::uuid, ${String(request.amountRwf)}, 'RWF', ${at},
              ${addSeconds(at, FAKE_SETTLE_SECONDS)})
      ON CONFLICT (refund_id) DO NOTHING`;
    return inserted === 0 ? { kind: "DUPLICATE", providerStatus: "DUPLICATE_IGNORED" } : { kind: "ACCEPTED", providerStatus: "ACCEPTED" };
  }

  async getRefund(refundId: string): Promise<RefundStatus> {
    const rows = await db().$queryRaw<{ amount: string; settles_at: Date; final_status: string | null }[]>`
      SELECT amount, settles_at, final_status FROM devsim.refunds WHERE refund_id = ${refundId}::uuid`;
    const row = rows[0];
    if (!row) return { kind: "NOT_FOUND" };
    if (!row.final_status && row.settles_at <= now()) {
      await db().$executeRaw`UPDATE devsim.refunds SET final_status = 'COMPLETED' WHERE refund_id = ${refundId}::uuid AND final_status IS NULL`;
      row.final_status = "COMPLETED";
    }
    const evidence = { ref: `devsim:refund:${refundId}`, observedAt: now().toISOString() };
    if (row.final_status === "COMPLETED") {
      return { kind: "SUCCEEDED", providerStatus: "COMPLETED", amountRwf: Number(row.amount), currency: "RWF", evidence };
    }
    if (row.final_status === "FAILED") return { kind: "FAILED", providerStatus: "FAILED", failureCode: "REFUND_FAILED", evidence };
    return { kind: "PENDING", providerStatus: "PROCESSING" };
  }
}
