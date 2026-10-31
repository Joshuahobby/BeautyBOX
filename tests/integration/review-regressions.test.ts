import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { setAdaptersForTests } from "@/adapters/registry";
import { FakePaymentAdapter } from "@/adapters/payments/fake";
import { FakeSmsAdapter } from "@/adapters/sms/fake";
import type { DepositStatus, PaymentAdapter } from "@/adapters/payments/types";
import { claimDueJobs } from "@/modules/jobs/outbox";
import { ingestProviderCallback } from "@/modules/payments/handlers";
import { applyVerifiedSuccess } from "@/modules/payments/outcomes";
import { getCartView } from "@/modules/cart/cart";
import { POST as createSession } from "@/app/api/v1/session/route";
import {
  addToCart,
  advanceSeconds,
  drainJobs,
  expectDomainError,
  key,
  newCustomer,
  pay,
  readyCheckout,
  resetDatabase,
  seedShop,
  settleAndDrain,
  startFreshRateLimitWindow,
  type Shop,
} from "./harness";

// Regression tests for findings confirmed by the adversarial review (docs/REVIEW-FINDINGS.md).

let shop: Shop;
beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
});

function adapterWithLookup(getDeposit: (depositId: string, real: FakePaymentAdapter) => Promise<DepositStatus>): PaymentAdapter {
  const real = new FakePaymentAdapter();
  return {
    provider: "FAKE",
    getEnabledMethods: () => real.getEnabledMethods(),
    initiateDeposit: (r) => real.initiateDeposit(r),
    getDeposit: (id) => getDeposit(id, real),
    verifyCallback: (r) => real.verifyCallback(r),
    initiateRefund: (r) => real.initiateRefund(r),
    getRefund: (id) => real.getRefund(id),
  };
}

describe("RF-01 payment status checks survive a long provider lookup outage", () => {
  it("backs off, never retires the check, and applies the success once the provider recovers", async () => {
    let outage = true;
    setAdaptersForTests({
      payments: adapterWithLookup(async (id, real) => (outage ? { kind: "UNKNOWN", reason: "timeout" } : real.getDeposit(id))),
    });
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const { attemptId } = await pay(c, await readyCheckout(c));
    await drainJobs(); // initiation accepted (initiate does not need the lookup)
    // Far more claims than the old 50-attempt budget, with polls pulling the check forward.
    for (let i = 0; i < 100; i++) {
      advanceSeconds(760); // beyond the capped, jittered backoff, so every round claims the check
      await drainJobs(2);
    }
    const job = await db().outboxJob.findFirstOrThrow({ where: { type: "PAYMENT_CHECK", entityId: attemptId } });
    expect(job.state).not.toBe("NEEDS_REVIEW");
    expect(job.attempts).toBeGreaterThan(50);
    const stuck = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(stuck.state).toBe("PENDING");
    expect(stuck.verificationFlag).toBe("NEEDS_REVIEW"); // visible to finance after hours unresolved
    expect(stuck.nextCheckAt!.getTime()).toBeGreaterThan(Date.now());

    outage = false;
    await settleAndDrain(760);
    const resolved = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { order: true } });
    expect(resolved.state).toBe("SUCCEEDED");
    expect(await db().paymentReceipt.count()).toBe(1);
  });
});

describe("RF-02 identical payment retry replays even if the checkout was paused in between", () => {
  it("returns the existing attempt instead of a 503", async () => {
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const ready = await readyCheckout(c);
    const k = key();
    const first = await pay(c, ready, { idempotencyKey: k });
    const s = await db().settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
    const { id: _id, version: _v, createdAt: _c, supportContact: _sc, ...rest } = s;
    await db().settingsVersion.create({ data: { ...rest, version: s.version + 1, checkoutEnabled: false, reason: "pause" } });
    const again = await pay(c, ready, { idempotencyKey: k });
    expect(again).toEqual({ attemptId: first.attemptId, replayed: true });
    // A new key on a paused checkout is still refused.
    await expectDomainError(pay(c, ready), "PROVIDER_UNAVAILABLE");
  });
});

describe("RF-03 an SMS is never re-sent after a lost lease", () => {
  async function paidWithPendingNotification() {
    const sms = new FakeSmsAdapter();
    setAdaptersForTests({ sms });
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const { attemptId } = await pay(c, await readyCheckout(c));
    await drainJobs(); // initiation only; the deposit has not settled yet
    await applyVerifiedSuccess(attemptId, { amountRwf: 17100, currency: "RWF", providerTransactionId: "rf03", providerStatus: "COMPLETED", evidenceRef: "rf03" });
    const job = await db().outboxJob.findFirstOrThrow({ where: { type: "NOTIFICATION_SEND" } });
    return { sms, job };
  }

  it("marks a possibly-sent message for review instead of sending it again", async () => {
    const { sms, job } = await paidWithPendingNotification();
    const [claimed] = await claimDueJobs({ batchSize: 1, leaseSeconds: 60, owner: "doomed", onlyJobId: job.id });
    expect(claimed?.id).toBe(job.id);
    // The doomed worker claimed the message and died before recording the outcome.
    await db().notification.update({ where: { id: job.entityId }, data: { state: "UNKNOWN", lastErrorCode: "SEND_IN_PROGRESS" } });
    advanceSeconds(61);
    await drainJobs();
    expect(sms.sent).toHaveLength(0);
    expect((await db().outboxJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe("NEEDS_REVIEW");
  });

  it("sends a confirmation exactly once even if its job is run again", async () => {
    const { sms, job } = await paidWithPendingNotification();
    await drainJobs();
    expect(sms.sent).toHaveLength(1);
    await db().outboxJob.update({ where: { id: job.id }, data: { state: "RETRY_DUE", dueAt: new Date(0) } });
    await drainJobs();
    expect(sms.sent).toHaveLength(1);
  });
});

describe("RF-04 the cart stays readable right after a purchase", () => {
  it("gives the same session a fresh empty cart in the conversion transaction", async () => {
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const paidCart = await getCartView(c);
    await pay(c, await readyCheckout(c));
    await drainJobs();
    await settleAndDrain();
    const fresh = await getCartView(c); // no POST /session needed
    expect(fresh.id).not.toBe(paidCart.id);
    expect(fresh.lines).toHaveLength(0);
  });
});

describe("RF-05 session creation is rate limited even with a forged cookie", () => {
  it("limits requests that would create a session", async () => {
    startFreshRateLimitWindow();
    const origin = process.env.APP_ORIGIN!;
    const send = () =>
      createSession(
        new NextRequest(`${origin}/api/v1/session`, {
          method: "POST",
          headers: { origin, cookie: "bb_guest=forged-cookie-value-that-is-long-enough-1234567890", "x-forwarded-for": "198.51.100.7" },
        }),
        { params: Promise.resolve({}) },
      );
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await send()).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
  });
});

describe("RF-06 unverified callbacks cannot fill the event table", () => {
  it("stops storing forged events after the per-address limit", async () => {
    startFreshRateLimitWindow();
    const forged = (i: number) =>
      ingestProviderCallback(
        { rawBody: Buffer.from(JSON.stringify({ depositId: crypto.randomUUID(), status: "COMPLETED", n: i })), headers: new Headers({ "x-devsim-signature": `bad-${i}` }), method: "POST", url: "http://localhost/api/v1/callbacks/pawapay" },
        { clientAddress: "203.0.113.9" },
      ).catch((e: { code?: string }) => e.code);
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 24; i++) codes.push((await forged(i)) as string | undefined);
    expect(codes.slice(0, 20).every((c) => c === "UNAUTHORIZED")).toBe(true);
    expect(codes.slice(20).every((c) => c === "RATE_LIMITED")).toBe(true);
    expect(await db().providerEvent.count()).toBe(20);
  });
});
