import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setAdaptersForTests } from "@/adapters/registry";
import { PAWAPAY_BASE_URLS, PawapayPaymentAdapter } from "@/adapters/payments/pawapay";
import { decideRefund, requestRefund } from "@/modules/refunds/refunds";
import { getCustomerOrderView } from "@/modules/orders/customer-views";
import { isDomainError } from "@/modules/shared/errors";
import { addToCart, advanceSeconds, drainJobs, newCustomer, pay, readyCheckout, resetDatabase, seedShop, type Shop } from "./harness";

// DR-042/DR-043: the whole purchase and refund path (real database, real domain code, real
// adapter) against the REAL pawaPay sandbox, with pawaPay's Rwanda test numbers. Opt-in,
// because it needs the network and the sandbox API token:
//   RUN_PAWAPAY_SANDBOX_TESTS=1 npx vitest run --project integration tests/integration/pawapay-sandbox.test.ts
// The token comes from .env.local (never printed), and only PAWAPAY_MODE=sandbox is accepted.
// No money moves: sandbox payments and refunds are simulated by pawaPay.

function localEnv(): Record<string, string> {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const enabled = process.env.RUN_PAWAPAY_SANDBOX_TESTS === "1";
const env = enabled ? localEnv() : {};
if (enabled && (env.PAWAPAY_MODE !== "sandbox" || !env.PAWAPAY_API_TOKEN || env.PAWAPAY_BASE_URL)) {
  throw new Error("The pawaPay sandbox tests run only with PAWAPAY_MODE=sandbox, a sandbox token and no PAWAPAY_BASE_URL in .env.local.");
}
const SLOW = 240_000;

describe.skipIf(!enabled)("purchases and refunds against the real pawaPay sandbox", () => {
  // Signs deposits and refunds when .env.local has a signing key (scripts/ops/pawapay-signing-key.ts).
  const signing = env.PAWAPAY_SIGNING_PRIVATE_KEY && env.PAWAPAY_SIGNING_KEY_ID ? { keyId: env.PAWAPAY_SIGNING_KEY_ID, privateKeyPem: env.PAWAPAY_SIGNING_PRIVATE_KEY } : undefined;
  const adapter = enabled ? new PawapayPaymentAdapter({ baseUrl: PAWAPAY_BASE_URLS.sandbox, apiToken: env.PAWAPAY_API_TOKEN!, signing }) : (null as unknown as PawapayPaymentAdapter);
  let shop: Shop;

  beforeEach(async () => {
    await resetDatabase();
    shop = await seedShop({ reservationTtlSeconds: 900 });
    setAdaptersForTests({ payments: adapter });
  });

  /** Runs due jobs (moving the app's clock so checks fall due) until `done`, waiting for pawaPay in real time. */
  async function until(done: () => Promise<boolean>, seconds = 60) {
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      advanceSeconds(15);
      await drainJobs();
      if (await done()) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(`not settled within ${seconds}s`);
  }

  async function checkoutAndPay(phone: string, method: "MTN_MOMO_RWA" | "AIRTEL_RWA") {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const ready = await readyCheckout(customer);
    const { attemptId } = await pay(customer, ready, { phone, method });
    const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    await until(async () => ["SUCCEEDED", "FAILED"].includes((await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).state));
    const settled = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const order = await db().order.findUniqueOrThrow({ where: { id: settled.orderId } });
    return { customer, total: ready.total, attempt: settled, order, depositId: attempt.providerDepositId };
  }

  async function financeStaff() {
    const authUserId = randomUUID();
    const member = await db().staffMember.create({ data: { authUserId, email: `finance-${authUserId.slice(0, 6)}@example.test`, displayName: "Test FINANCE", role: "FINANCE" } });
    return { staffId: member.id, authUserId, role: member.role, displayName: member.displayName, email: member.email, roleVersion: member.roleVersion };
  }

  async function approve(orderId: string, amountRwf: number) {
    const finance = await financeStaff();
    const receipt = await db().paymentReceipt.findFirstOrThrow({ where: { orderId } });
    const requested = await requestRefund(finance, { orderId, receiptId: receipt.id, amountRwf, reason: "Sandbox refund" }, `test-${randomUUID()}`, null);
    await decideRefund(finance, requested.id, { expectedVersion: requested.version, decision: "APPROVE", reason: "ok" }, `test-${randomUUID()}`, null);
    return db().refund.findUniqueOrThrow({ where: { id: requested.id } });
  }

  const refundState = async (id: string) => (await db().refund.findUniqueOrThrow({ where: { id } })).state;
  const final = (state: string) => state === "SUCCEEDED" || state === "FAILED";

  it(
    "an MTN success number is paid only after pawaPay's status check; two refunds approved together go one at a time, then the rest; nothing more can be refunded",
    async () => {
      const { attempt, order, total, depositId } = await checkoutAndPay("+250783456789", "MTN_MOMO_RWA");
      expect(attempt.state).toBe("SUCCEEDED");
      expect(order.state).toBe("PAID");
      const receipt = await db().paymentReceipt.findFirstOrThrow({ where: { orderId: order.id } });
      expect(Number(receipt.verifiedAmountRwf)).toBe(total);
      expect(receipt.evidenceRef).toMatch(new RegExp(`^pawapay:deposit:${depositId}:COMPLETED:`));

      const a = await approve(order.id, 1000);
      const b = await approve(order.id, 2000);
      await until(async () => final(await refundState(a.id)) && final(await refundState(b.id)));
      const rest = await approve(order.id, total - 3000);
      await until(async () => final(await refundState(rest.id)));

      for (const r of [a, b, rest]) {
        const done = await db().refund.findUniqueOrThrow({ where: { id: r.id } });
        expect(done).toMatchObject({ state: "SUCCEEDED", verificationFlag: null });
        expect(await adapter.getRefund(done.providerRefundId!)).toMatchObject({ kind: "SUCCEEDED", amountRwf: Number(done.amountRwf), currency: "RWF" });
      }
      expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).paymentState).toBe("REFUNDED");
      const more = await approve(order.id, 1).catch((e: unknown) => e);
      expect(isDomainError(more) && more.code).toBe("REFUND_LIMIT");
    },
    SLOW,
  );

  it(
    "declined (MTN) and insufficient balance (Airtel) fail with pawaPay's reasons, and Airtel's success number pays",
    async () => {
      const declined = await checkoutAndPay("+250783456039", "MTN_MOMO_RWA");
      expect(declined.attempt).toMatchObject({ state: "FAILED", failureCode: "PAYMENT_NOT_APPROVED" });
      expect(declined.order.state).not.toBe("PAID");
      const broke = await checkoutAndPay("+250733456049", "AIRTEL_RWA");
      expect(broke.attempt).toMatchObject({ state: "FAILED", failureCode: "INSUFFICIENT_BALANCE" });
      const airtel = await checkoutAndPay("+250733456789", "AIRTEL_RWA");
      expect(airtel.attempt.state).toBe("SUCCEEDED");
      expect(airtel.order.state).toBe("PAID");
    },
    SLOW,
  );

  it(
    "a refund for a payment already refunded outside the app is refused by pawaPay, failed and flagged for finance; the customer sees it under review",
    async () => {
      const { order, total, depositId, customer } = await checkoutAndPay("+250783456789", "MTN_MOMO_RWA");
      const outside = { refundId: randomUUID(), depositId, amountRwf: total };
      expect((await adapter.initiateRefund(outside)).kind).toBe("ACCEPTED");
      await until(async () => (await adapter.getRefund(outside.refundId)).kind === "SUCCEEDED");

      const refund = await approve(order.id, 1000);
      await until(async () => final(await refundState(refund.id)));
      expect(await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ state: "FAILED", failureCode: "INVALID_STATE", verificationFlag: "NEEDS_REVIEW" });
      expect((await getCustomerOrderView(order.id, { guestSession: customer, orderSessionTokens: [] })).refunds.map((r) => r.state)).toEqual(["UNDER_REVIEW"]);
    },
    SLOW,
  );

  it(
    "a refund sent while pawaPay is still processing one made outside the app is retried under the same id, completes, and is flagged for finance",
    async () => {
      // pawaPay finishes a sandbox refund within seconds, so the app's refund must be sent while
      // the outside one is still processing. Up to three tries; the test fails if none caught it.
      let caught: { refund: Awaited<ReturnType<typeof approve>>; outside: { refundId: string } } | null = null;
      const seen: string[] = [];
      for (let attempt = 0; attempt < 3 && !caught; attempt++) {
        const { order, depositId } = await checkoutAndPay("+250783456789", "MTN_MOMO_RWA");
        const refund = await approve(order.id, 1000);
        const outside = { refundId: randomUUID(), depositId, amountRwf: 500 };
        expect((await adapter.initiateRefund(outside)).kind).toBe("ACCEPTED");
        await drainJobs(); // submits at once
        const afterFirstTry = await db().refund.findUniqueOrThrow({ where: { id: refund.id } });
        const job = await db().outboxJob.findFirst({ where: { entityId: refund.id, type: "REFUND_SUBMIT" } });
        seen.push(`${afterFirstTry.state}/${afterFirstTry.failureCode ?? "-"}/${job?.state}/${job?.lastErrorCode ?? "-"}`);
        if (afterFirstTry.state === "SUBMITTED") caught = { refund, outside };
      }
      expect(caught, `pawaPay had already finished the outside refund in all three tries: ${seen.join(", ")}`).not.toBeNull();
      const { refund, outside } = caught!;
      expect(await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ state: "SUBMITTED", verificationFlag: "NEEDS_REVIEW" });
      expect((await db().outboxJob.findFirst({ where: { entityId: refund.id, type: "REFUND_SUBMIT" } }))?.lastErrorCode).toBe("REFUND_PROVIDER_BUSY");

      await until(async () => final(await refundState(refund.id)));
      const done = await db().refund.findUniqueOrThrow({ where: { id: refund.id } });
      expect(done).toMatchObject({ state: "SUCCEEDED", verificationFlag: "NEEDS_REVIEW" });
      expect(await adapter.getRefund(done.providerRefundId!)).toMatchObject({ kind: "SUCCEEDED", amountRwf: 1000 });
      expect(await adapter.getRefund(outside.refundId)).toMatchObject({ kind: "SUCCEEDED", amountRwf: 500 });
    },
    SLOW,
  );
});
