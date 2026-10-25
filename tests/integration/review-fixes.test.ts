import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db, transaction } from "@/server/db";
import { setAdaptersForTests } from "@/adapters/registry";
import { FakePaymentAdapter } from "@/adapters/payments/fake";
import type { DepositRequest, DepositStatus, InitiationResult, RefundRequest, RefundStatus } from "@/adapters/payments/types";
import type { SmsAdapter, SmsSendResult } from "@/adapters/sms/types";
import { applyOrderCommand, type OrderCommand } from "@/modules/fulfillment/commands";
import { decideRefund, reconcileRefund, requestRefund } from "@/modules/refunds/refunds";
import { openRefundCase } from "@/modules/refunds/cases";
import { reconcilePayment } from "@/modules/payments/reconcile";
import { reissueOrderAccess } from "@/modules/orders/access-reissue";
import { getCustomerOrderView } from "@/modules/orders/customer-views";
import { getStaffOrder } from "@/modules/orders/staff-views";
import { exchangePrivateLink, issueLinkForOwner } from "@/modules/orders/private-links";
import { createUploadIntent } from "@/modules/media/uploads";
import { opsSummary } from "@/modules/ops/summary";
import { reconciliationSweep } from "@/modules/ops/reconciliation";
import { getSettings, updateSettings } from "@/modules/settings/admin";
import type { StaffIdentity } from "@/modules/staff/identity";
import { GET as getSweep } from "@/app/api/v1/internal/reconciliation/route";
import {
  PHONES,
  addToCart,
  advanceSeconds,
  drainJobs,
  expectDomainError,
  lotTotals,
  newCustomer,
  ownerQuery,
  pay,
  readyCheckout,
  resetDatabase,
  seedShop,
  settleAndDrain,
  type Shop,
} from "./harness";

// Regression tests for the second adversarial review (docs/REVIEW-FINDINGS.md RF-09..RF-38).

let shop: Shop;
beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
});

type Role = "ADMIN" | "OPERATIONS" | "FINANCE" | "SUPPORT";
async function staff(role: Role): Promise<StaffIdentity> {
  const authUserId = randomUUID();
  const m = await db().staffMember.create({ data: { authUserId, email: `${role.toLowerCase()}-${authUserId.slice(0, 6)}@example.test`, displayName: `R ${role}`, role } });
  return { staffId: m.id, authUserId, role: m.role, displayName: m.displayName, email: m.email, roleVersion: m.roleVersion };
}

const k = () => `test-${randomUUID()}`;

async function paidOrder(variantId = shop.cleanser.id, qty = 1) {
  const customer = await newCustomer();
  await addToCart(customer, variantId, qty);
  const { attemptId } = await pay(customer, await readyCheckout(customer));
  await drainJobs();
  await settleAndDrain(6);
  const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const order = await db().order.findUniqueOrThrow({ where: { id: attempt.orderId } });
  const receipt = await db().paymentReceipt.findFirstOrThrow({ where: { orderId: order.id } });
  return { customer, order, attempt, receipt };
}

async function command(actor: StaffIdentity, orderId: string, cmd: Record<string, unknown>) {
  const { version } = await db().order.findUniqueOrThrow({ where: { id: orderId } });
  await applyOrderCommand(actor, orderId, { ...cmd, expectedVersion: version } as OrderCommand, k(), null);
}

async function approvedRefund(finance: StaffIdentity, orderId: string, receiptId: string, amountRwf: number) {
  const r = await requestRefund(finance, { orderId, receiptId, amountRwf, reason: "Test refund" }, k(), null);
  return decideRefund(finance, r.id, { expectedVersion: r.version, decision: "APPROVE", reason: "ok" }, k(), null);
}

/** Fake provider with switchable refund behaviour. */
class ScriptedProvider extends FakePaymentAdapter {
  refundStatus = new Map<string, () => RefundStatus | null>();
  refundInitiate = new Map<string, () => InitiationResult | null>();
  depositStatus: ((id: string) => DepositStatus | null) | null = null;
  initiations = 0;
  override async initiateDeposit(request: DepositRequest): Promise<InitiationResult> {
    this.initiations++;
    return super.initiateDeposit(request);
  }
  override async getDeposit(id: string): Promise<DepositStatus> {
    return this.depositStatus?.(id) ?? super.getDeposit(id);
  }
  override async getRefund(id: string): Promise<RefundStatus> {
    return this.refundStatus.get(id)?.() ?? super.getRefund(id);
  }
  override async initiateRefund(request: RefundRequest): Promise<InitiationResult> {
    return this.refundInitiate.get(request.refundId)?.() ?? super.initiateRefund(request);
  }
}

describe("RF-09 a refund waiting behind another refund for the same deposit never gives up", () => {
  it("keeps waiting past 50 claims and is submitted as soon as the first refund finishes", async () => {
    const provider = new ScriptedProvider();
    setAdaptersForTests({ payments: provider });
    const finance = await staff("FINANCE");
    const { order, receipt } = await paidOrder();
    const first = await approvedRefund(finance, order.id, receipt.id, 4000);
    let firstDone = false;
    provider.refundStatus.set(first.providerRefundId!, () => (firstDone ? null : { kind: "PENDING", providerStatus: "PROCESSING" }));
    await drainJobs(); // the first refund is now with the provider
    const second = await approvedRefund(finance, order.id, receipt.id, 3000);
    for (let i = 0; i < 60; i++) {
      await drainJobs(2);
      advanceSeconds(380); // beyond the capped, jittered 300 s wait, so every round claims it
    }
    const waitingJob = await db().outboxJob.findUniqueOrThrow({ where: { uniqueIntentKey: `refund-submit:${second.providerRefundId}` } });
    expect(waitingJob.attempts).toBeGreaterThan(50);
    expect(waitingJob.state).not.toBe("NEEDS_REVIEW");
    expect((await db().refund.findUniqueOrThrow({ where: { id: second.id } })).state).toBe("QUEUED");

    firstDone = true;
    advanceSeconds(610);
    await drainJobs(); // the first refund completes and re-arms the second at once
    expect((await db().refund.findUniqueOrThrow({ where: { id: first.id } })).state).toBe("SUCCEEDED");
    expect(["SUBMITTED", "PENDING", "SUCCEEDED"]).toContain((await db().refund.findUniqueOrThrow({ where: { id: second.id } })).state);
    await settleAndDrain(10);
    await settleAndDrain(10);
    expect((await db().refund.findUniqueOrThrow({ where: { id: second.id } })).state).toBe("SUCCEEDED");
    expect(Number((await db().$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM devsim.refunds`)[0]!.n)).toBe(2);
  });
});

describe("RF-11 a refund the provider confirms for a different amount", () => {
  it("is recorded as done with the evidence, frees the deposit, alerts finance and is not announced to the customer", async () => {
    const provider = new ScriptedProvider();
    setAdaptersForTests({ payments: provider });
    const finance = await staff("FINANCE");
    const { order, receipt, customer } = await paidOrder();
    const odd = await approvedRefund(finance, order.id, receipt.id, 3000);
    let reported = false;
    provider.refundStatus.set(odd.providerRefundId!, () =>
      reported ? { kind: "SUCCEEDED", providerStatus: "COMPLETED", amountRwf: 2500, currency: "RWF", evidence: { ref: "x", observedAt: new Date().toISOString() } } : { kind: "PENDING", providerStatus: "PROCESSING" },
    );
    await drainJobs(); // the odd refund is with the provider
    const next = await approvedRefund(finance, order.id, receipt.id, 1000);
    await drainJobs(); // the next refund waits behind it
    const op = await reconcileRefund(finance, odd.id, "Customer asked", k(), null);
    reported = true;
    await settleAndDrain(10);
    const done = await db().refund.findUniqueOrThrow({ where: { id: odd.id } });
    expect(done).toMatchObject({ state: "SUCCEEDED", verificationFlag: "MISMATCH" });
    expect(Number(done.providerAmountRwf)).toBe(2500);
    const answered = await db().operation.findUniqueOrThrow({ where: { id: op.id } });
    expect(answered.state).toBe("FAILED");
    expect(answered.outcome).toMatch(/different amount/);
    await settleAndDrain(10);
    await settleAndDrain(10);
    expect((await db().refund.findUniqueOrThrow({ where: { id: next.id } })).state).toBe("SUCCEEDED");
    expect(await db().notification.count({ where: { event: "REFUND_CONFIRMED", intentKey: odd.id } })).toBe(0);
    expect(await db().notification.count({ where: { event: "REFUND_CONFIRMED", intentKey: next.id } })).toBe(1);
    const view = await getCustomerOrderView(order.id, { guestSession: customer, orderSessionTokens: [] });
    expect(view.refunds.find((r) => r.id === odd.id)?.state).toBe("UNDER_REVIEW");
    expect((await opsSummary()).alerts).toContain("REFUND_AMOUNT_MISMATCH");
  });
});

describe("RF-13 staff operations are always answered", () => {
  it("a payment check resolves when the provider has no record, and a reissue whose SMS outcome is unknown fails visibly", async () => {
    const provider = new ScriptedProvider();
    setAdaptersForTests({ payments: provider });
    const finance = await staff("FINANCE");
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const { attemptId } = await pay(c, await readyCheckout(c), { phone: PHONES.neverSettles });
    await drainJobs();
    provider.depositStatus = () => ({ kind: "NOT_FOUND" });
    const op = await reconcilePayment(finance, attemptId, "Customer says debited", k(), null);
    await drainJobs();
    const answered = await db().operation.findUniqueOrThrow({ where: { id: op.id } });
    expect(answered.state).toBe("SUCCEEDED");
    expect(answered.outcome).toMatch(/no record/);

    class LostSms implements SmsAdapter {
      readonly provider = "FAKE" as const;
      async sendTransactional(): Promise<SmsSendResult> {
        return { kind: "UNKNOWN", reason: "timeout" };
      }
    }
    setAdaptersForTests({ sms: new LostSms() });
    const support = await staff("SUPPORT");
    const { order } = await paidOrder();
    const reissue = await reissueOrderAccess(support, order.id, { expectedVersion: (await db().order.findUniqueOrThrow({ where: { id: order.id } })).version, verificationCaseReference: "C-1", reason: "Lost" }, k(), null);
    await drainJobs();
    const reissueOp = await db().operation.findUniqueOrThrow({ where: { id: reissue.id } });
    expect(reissueOp.state).toBe("FAILED");
    expect(reissueOp.outcome).toMatch(/could not confirm/);
  });
});

describe("RF-14 concurrent 'check now' clicks share one operation", () => {
  it("returns the same pending operation to two finance users instead of a 500", async () => {
    const a = await staff("FINANCE");
    const b = await staff("FINANCE");
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const { attemptId } = await pay(c, await readyCheckout(c), { phone: PHONES.neverSettles });
    await drainJobs();
    const [x, y] = await Promise.all([reconcilePayment(a, attemptId, "a", k(), null), reconcilePayment(b, attemptId, "b", k(), null)]);
    expect(x.id).toBe(y.id);
    const { order, receipt } = await paidOrder();
    const refund = await approvedRefund(a, order.id, receipt.id, 1000);
    await drainJobs();
    const [r1, r2] = await Promise.all([reconcileRefund(a, refund.id, "a", k(), null), reconcileRefund(b, refund.id, "b", k(), null)]);
    expect(r1.id).toBe(r2.id);
  });
});

describe("RF-15 a failed delivery with the goods back at BeautyBOX", () => {
  it("cannot be marked delivered without a new handover; redelivery moves no stock; the customer sees the problem", async () => {
    const ops = await staff("OPERATIONS");
    const { order, customer } = await paidOrder();
    await command(ops, order.id, { action: "START_PREPARATION", reason: "Packed" });
    await command(ops, order.id, { action: "ASSIGN_RIDER", reason: "Booked", riderReference: "R1" });
    await command(ops, order.id, { action: "HAND_OVER", reason: "Collected", riderReference: "R1", occurredAt: new Date().toISOString() });
    const shipped = await lotTotals(shop.cleanser.id);
    await command(ops, order.id, { action: "RECORD_FAILED_ATTEMPT", reason: "Nobody home", occurredAt: new Date().toISOString(), custody: "BEAUTYBOX" });
    const view = await getCustomerOrderView(order.id, { guestSession: customer, orderSessionTokens: [] });
    expect(view.fulfillment?.state).toBe("FAILED_ATTEMPT");
    await expectDomainError(command(ops, order.id, { action: "CONFIRM_DELIVERY", reason: "x", occurredAt: new Date().toISOString(), confirmationReference: "" }), "ACTION_NOT_ALLOWED");
    await command(ops, order.id, { action: "ASSIGN_RIDER", reason: "Second attempt", riderReference: "R2" });
    await command(ops, order.id, { action: "HAND_OVER", reason: "Collected again", riderReference: "R2", occurredAt: new Date().toISOString() });
    expect(await lotTotals(shop.cleanser.id)).toEqual(shipped);
    await command(ops, order.id, { action: "CONFIRM_DELIVERY", reason: "Delivered", occurredAt: new Date().toISOString(), confirmationReference: "Signed" });
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).state).toBe("DELIVERED");
  });
});

describe("RF-16 refund cases follow the money", () => {
  it("one open case per payment; a partial refund keeps a cancellation case open until fully refunded", async () => {
    const ops = await staff("OPERATIONS");
    const finance = await staff("FINANCE");
    const { order, receipt } = await paidOrder();
    const stockHold = await transaction((tx) => openRefundCase(tx, { orderId: order.id, receiptId: receipt.id, source: "STOCK_HOLD", reason: "No stock" }));
    await command(ops, order.id, { action: "CANCEL", reason: "Refund offered" });
    expect(await db().refundCase.count({ where: { receiptId: receipt.id } })).toBe(1);
    await approvedRefund(finance, order.id, receipt.id, 5000);
    await settleAndDrain(10);
    await settleAndDrain(10);
    expect((await db().refundCase.findUniqueOrThrow({ where: { id: stockHold! } })).state).toBe("OPEN");
    await approvedRefund(finance, order.id, receipt.id, Number(receipt.verifiedAmountRwf) - 5000);
    await settleAndDrain(10);
    await settleAndDrain(10);
    expect((await db().refundCase.findUniqueOrThrow({ where: { id: stockHold! } })).state).toBe("CLOSED");
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).paymentState).toBe("REFUNDED");
    expect((await reconciliationSweep()).issues).toBe(0);
  });
});

describe("RF-17 the customer only sees refunds that are actually happening", () => {
  it("hides requests until approved and a failure that a later refund replaced", async () => {
    const provider = new ScriptedProvider();
    setAdaptersForTests({ payments: provider });
    const finance = await staff("FINANCE");
    const { order, receipt, customer } = await paidOrder();
    const viewer = { guestSession: customer, orderSessionTokens: [] };
    const requested = await requestRefund(finance, { orderId: order.id, receiptId: receipt.id, amountRwf: 2000, reason: "Goodwill" }, k(), null);
    expect((await getCustomerOrderView(order.id, viewer)).refunds).toEqual([]);
    const approved = await decideRefund(finance, requested.id, { expectedVersion: requested.version, decision: "APPROVE", reason: "ok" }, k(), null);
    // Refused outright, with no disagreement about the payment: a plain failure (DR-043; a
    // refusal where the provider's records differ is covered in pawapay-flow.test.ts).
    provider.refundInitiate.set(approved.providerRefundId!, () => ({ kind: "REJECTED", failureCode: "PROVIDER_REJECTED" }));
    await drainJobs();
    expect((await getCustomerOrderView(order.id, viewer)).refunds.map((r) => r.state)).toEqual(["FAILED"]);
    await approvedRefund(finance, order.id, receipt.id, 2000);
    await settleAndDrain(10);
    await settleAndDrain(10);
    expect((await getCustomerOrderView(order.id, viewer)).refunds.map((r) => r.state)).toEqual(["SUCCEEDED"]);
  });

  it("shows a refund the provider reports as failed as failed, until a later refund replaces it", async () => {
    const provider = new ScriptedProvider();
    setAdaptersForTests({ payments: provider });
    const finance = await staff("FINANCE");
    const { order, receipt, customer } = await paidOrder();
    const viewer = { guestSession: customer, orderSessionTokens: [] };
    const failing = await approvedRefund(finance, order.id, receipt.id, 2000);
    provider.refundStatus.set(failing.providerRefundId!, () => ({ kind: "FAILED", providerStatus: "FAILED", failureCode: "RECIPIENT_NOT_ALLOWED_TO_RECEIVE", evidence: { ref: "x", observedAt: new Date().toISOString() } }));
    await settleAndDrain(10); // submitted
    await settleAndDrain(10); // checked: failed
    expect(await db().refund.findUniqueOrThrow({ where: { id: failing.id } })).toMatchObject({ state: "FAILED", verificationFlag: null });
    expect((await getCustomerOrderView(order.id, viewer)).refunds.map((r) => r.state)).toEqual(["FAILED"]);
    await approvedRefund(finance, order.id, receipt.id, 2000);
    await settleAndDrain(10);
    await settleAndDrain(10);
    expect((await getCustomerOrderView(order.id, viewer)).refunds.map((r) => r.state)).toEqual(["SUCCEEDED"]);
  });
});

describe("RF-18 support can reissue access whenever money was verified", () => {
  it("works for an order cancelled before its payment verified", async () => {
    const ops = await staff("OPERATIONS");
    const support = await staff("SUPPORT");
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const { attemptId } = await pay(c, await readyCheckout(c));
    await drainJobs();
    const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    await command(ops, attempt.orderId, { action: "CANCEL", reason: "Changed mind" });
    await settleAndDrain(6); // late success: AFTER_CANCELLATION receipt
    const order = await db().order.findUniqueOrThrow({ where: { id: attempt.orderId } });
    const op = await reissueOrderAccess(support, order.id, { expectedVersion: order.version, verificationCaseReference: "C-2", reason: "New phone" }, k(), null);
    expect(op.state).toBe("PENDING");
    expect((await reconciliationSweep()).issues).toBe(0);
  });
});

describe("RF-20 no wallet prompt after the reservation expired", () => {
  it("a backlogged first initiation fails the never-sent attempt instead of prompting", async () => {
    const provider = new ScriptedProvider();
    setAdaptersForTests({ payments: provider });
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const { attemptId } = await pay(c, await readyCheckout(c));
    advanceSeconds(20 * 60); // the worker was stopped longer than the reservation TTL
    await drainJobs();
    expect(provider.initiations).toBe(0);
    const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt).toMatchObject({ state: "FAILED", failureCode: "NOT_INITIATED_RESERVATION_EXPIRED" });
    expect(await lotTotals(shop.cleanser.id)).toMatchObject({ reserved: 0, committed: 0 });
  });
});

describe("RF-21 a transient lookup error does not pause a fresh payment's checks", () => {
  it("retries within a short interval while the customer may be watching", async () => {
    const provider = new ScriptedProvider();
    setAdaptersForTests({ payments: provider });
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const { attemptId } = await pay(c, await readyCheckout(c), { phone: PHONES.neverSettles });
    await drainJobs();
    for (let i = 0; i < 8; i++) {
      advanceSeconds(16);
      await drainJobs(1);
    }
    provider.depositStatus = () => ({ kind: "UNKNOWN", reason: "5xx" });
    advanceSeconds(61);
    await drainJobs(1);
    const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const waitSeconds = (attempt.nextCheckAt!.getTime() - attempt.checkedAt!.getTime()) / 1000;
    expect(waitSeconds).toBeLessThanOrEqual(60);
  });
});

describe("RF-23 roles without contact access see neither contact nor free-text that may contain it", () => {
  it("masks the phone in contract format and redacts fulfilment reasons in the history", async () => {
    const ops = await staff("OPERATIONS");
    const finance = await staff("FINANCE");
    const { order } = await paidOrder();
    await command(ops, order.id, { action: "START_PREPARATION", reason: "Packed" });
    await command(ops, order.id, { action: "ASSIGN_RIDER", reason: "Booked", riderReference: "R1" });
    await command(ops, order.id, { action: "HAND_OVER", reason: "Collected", riderReference: "R1", occurredAt: new Date().toISOString() });
    await command(ops, order.id, { action: "RECORD_FAILED_ATTEMPT", reason: "Recipient +250788123456 not answering at gate 3", occurredAt: new Date().toISOString(), custody: "RIDER" });
    const view = await getStaffOrder(finance, order.id);
    expect(view.recipient.phone).toMatch(/^\+2507\*{6}\d{2}$/);
    expect(view.destination).toBeNull();
    expect(JSON.stringify(view.audit)).not.toMatch(/250788123456|gate 3/);
    expect(JSON.stringify((await getStaffOrder(ops, order.id)).audit)).toMatch(/gate 3/);
  });
});

describe("RF-24 media uploads follow the contract", () => {
  it("only ADMIN/OPERATIONS may upload, and the same idempotency key returns the same intent", async () => {
    const ops = await staff("OPERATIONS");
    const support = await staff("SUPPORT");
    await expectDomainError(createUploadIntent(support, { purpose: "PRIVATE_EVIDENCE", mimeType: "image/png", sizeBytes: 100 }, k(), null), "FORBIDDEN");
    const key = k();
    const a = await createUploadIntent(ops, { purpose: "PRODUCT_PHOTO", mimeType: "image/png", sizeBytes: 100 }, key, null);
    const b = await createUploadIntent(ops, { purpose: "PRODUCT_PHOTO", mimeType: "image/png", sizeBytes: 100 }, key, null);
    expect(b.uploadId).toBe(a.uploadId);
    expect(await db().mediaUpload.count()).toBe(1);
  });
});

describe("RF-25 one browser can hold private access to several orders", () => {
  it("keeps access to the first order after opening the second order's link", async () => {
    const first = await paidOrder();
    const second = await paidOrder();
    const linkA = await issueLinkForOwner({ guestSession: first.customer, orderSessionTokens: [] }, first.order.id);
    const linkB = await issueLinkForOwner({ guestSession: second.customer, orderSessionTokens: [] }, second.order.id);
    const token = (url: string) => /#token=([A-Za-z0-9_-]+)/.exec(url)![1]!;
    const browser: string[] = [];
    const a = await exchangePrivateLink(token(linkA.url), { guestSession: null, orderSessionTokens: browser });
    if (a.kind === "OK" && a.session) browser.push(a.session.token);
    const b = await exchangePrivateLink(token(linkB.url), { guestSession: null, orderSessionTokens: browser });
    if (b.kind === "OK" && b.session) browser.push(b.session.token);
    expect(browser).toHaveLength(2);
    expect((await getCustomerOrderView(first.order.id, { guestSession: null, orderSessionTokens: browser })).id).toBe(first.order.id);
    expect((await getCustomerOrderView(second.order.id, { guestSession: null, orderSessionTokens: browser })).id).toBe(second.order.id);
  });
});

describe("RF-35/RF-37 monitoring alerts clear and cover stuck refunds and stock drift", () => {
  it("an old SMS failure stops alerting; a refund stuck for a day and ledger drift alert", async () => {
    class FailingSms implements SmsAdapter {
      readonly provider = "FAKE" as const;
      async sendTransactional(): Promise<SmsSendResult> {
        return { kind: "FAILED", code: "UNREACHABLE" };
      }
    }
    const provider = new ScriptedProvider();
    setAdaptersForTests({ sms: new FailingSms(), payments: provider });
    const finance = await staff("FINANCE");
    const { order, receipt } = await paidOrder();
    for (let i = 0; i < 4; i++) {
      advanceSeconds(700);
      await drainJobs();
    }
    expect((await opsSummary()).alerts).toContain("SMS_NOT_DELIVERED");
    await ownerQuery(`UPDATE commerce.notifications SET updated_at = now() - interval '8 days'`);
    await ownerQuery(`UPDATE commerce.outbox_jobs SET updated_at = now() - interval '8 days' WHERE state = 'NEEDS_REVIEW'`);
    const quiet = await opsSummary();
    expect(quiet.alerts).not.toContain("SMS_NOT_DELIVERED");
    expect(quiet.alerts).not.toContain("JOBS_NEED_REVIEW");

    const stuck = await approvedRefund(finance, order.id, receipt.id, 1000);
    provider.refundStatus.set(stuck.providerRefundId!, () => ({ kind: "PENDING", providerStatus: "PROCESSING" }));
    await drainJobs();
    advanceSeconds(25 * 60 * 60);
    expect((await opsSummary()).alerts).toContain("REFUNDS_STUCK");

    const lot = await db().inventoryLot.findFirstOrThrow({ where: { variantId: shop.last.id } });
    await ownerQuery(`UPDATE commerce.inventory_lots SET quantity_on_hand = quantity_on_hand + 1 WHERE id = $1`, [lot.id]);
    expect((await opsSummary()).alerts).toContain("STOCK_LEDGER_DRIFT");
    const sweep = await getSweep(new NextRequest(`${process.env.APP_ORIGIN}/api/v1/internal/reconciliation`, { headers: { authorization: `Bearer ${process.env.WORKER_SECRET}` } }), { params: Promise.resolve({}) });
    const body = (await sweep.json()) as { checks: { code: string; count: number }[] };
    expect(body.checks.find((c) => c.code === "LEDGER_DRIFT")?.count).toBe(1);
  });
});

describe("RF-36 order payment state follows only the money collected for the order", () => {
  it("refunding an overpayment leaves the order paid; the sweep stays clean through cancel-then-late-success", async () => {
    const ops = await staff("OPERATIONS");
    const finance = await staff("FINANCE");
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const { attemptId } = await pay(c, await readyCheckout(c));
    await drainJobs();
    const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    await command(ops, attempt.orderId, { action: "CANCEL", reason: "Changed mind" });
    await settleAndDrain(6);
    expect((await reconciliationSweep()).issues).toBe(0);
    const late = await db().paymentReceipt.findFirstOrThrow({ where: { orderId: attempt.orderId } });
    expect(late.disposition).toBe("AFTER_CANCELLATION");
    await approvedRefund(finance, attempt.orderId, late.id, Number(late.verifiedAmountRwf));
    await settleAndDrain(10);
    await settleAndDrain(10);
    expect((await db().order.findUniqueOrThrow({ where: { id: attempt.orderId } })).paymentState).toBe("REFUNDED");
    expect((await reconciliationSweep()).issues).toBe(0);

    // An overpayment receipt on a paid order: refunding it does not touch the order's state.
    const { order } = await paidOrder();
    const extra = await db().paymentReceipt.create({
      data: { attemptId: (await db().paymentAttempt.create({ data: { ...(await cloneAttempt(order.id)) } })).id, orderId: order.id, verifiedAmountRwf: 5000n, currency: "RWF", disposition: "OVERPAYMENT", providerTransactionId: `extra-${randomUUID()}`, evidenceRef: "test", verifiedAt: new Date() },
    });
    await transaction((tx) => openRefundCase(tx, { orderId: order.id, receiptId: extra.id, source: "OVERPAYMENT", reason: "Extra" }));
    await approvedRefund(finance, order.id, extra.id, 5000);
    await settleAndDrain(10);
    await settleAndDrain(10);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).paymentState).toBe("PAID");
  });
});

/** A second, superseded attempt row for an order (test-only), used to attach an extra receipt. */
async function cloneAttempt(orderId: string) {
  const a = await db().paymentAttempt.findFirstOrThrow({ where: { orderId } });
  const { id: _id, providerDepositId: _d, createdAt: _c, updatedAt: _u, ...rest } = a;
  return { ...rest, providerDepositId: randomUUID(), state: "SUCCEEDED" as const };
}

describe("RF-38 clearing dispatch hours", () => {
  it("writes no hours instead of silently keeping the old ones", async () => {
    const admin = await staff("ADMIN");
    let current = await getSettings(admin);
    const { version: _v, publicationBlocks: _p, ...editable } = current;
    current = await updateSettings(admin, { expectedVersion: current.version, settings: { ...editable, dispatchHours: "Mon-Sat 09:00-18:00" }, reason: "Hours" }, k(), null);
    expect(current.dispatchHours).toBe("Mon-Sat 09:00-18:00");
    const { version: _v2, publicationBlocks: _p2, ...again } = current;
    current = await updateSettings(admin, { expectedVersion: current.version, settings: { ...again, dispatchHours: null }, reason: "Clear hours" }, k(), null);
    expect(current.dispatchHours).toBeNull();
  });
});
