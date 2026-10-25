import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { setAdaptersForTests } from "@/adapters/registry";
import { PawapayPaymentAdapter } from "@/adapters/payments/pawapay";
import { decideRefund, receiptView, reconcileRefund, requestRefund, resolveRefundReview } from "@/modules/refunds/refunds";
import { isDomainError } from "@/modules/shared/errors";
import { getCustomerOrderView } from "@/modules/orders/customer-views";
import { getStaffOrder } from "@/modules/orders/staff-views";
import { opsSummary } from "@/modules/ops/summary";
import { reconciliationSweep } from "@/modules/ops/reconciliation";
import { applyOrderCommand, type OrderCommand } from "@/modules/fulfillment/commands";
import { POST as postCallback } from "@/app/api/v1/callbacks/pawapay/route";
import { addToCart, advanceSeconds, drainJobs, ledgerMismatches, newCustomer, pay, readyCheckout, resetDatabase, seedShop, settleAndDrain, type Shop } from "./harness";
import { startPawapayMock, type PawapayMock } from "../support/pawapay-mock";

// The whole purchase and refund path through the real pawaPay adapter (I07, DR-042), with
// the real database and domain code, against a local imitation of the pawaPay v2 API.
// Nothing here talks to pawaPay.

let mock: PawapayMock;
let shop: Shop;
beforeAll(async () => {
  mock = await startPawapayMock();
});
afterAll(() => mock.close());
beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop({ reservationTtlSeconds: 900 });
  setAdaptersForTests({ payments: new PawapayPaymentAdapter({ baseUrl: mock.url, apiToken: mock.token, timeoutMs: 2_000 }) });
});

async function checkoutAndPay(phone: string) {
  const customer = await newCustomer();
  await addToCart(customer, shop.cleanser.id, 1);
  const ready = await readyCheckout(customer);
  const { attemptId } = await pay(customer, ready, { phone });
  const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  return { customer, ready, attemptId, depositId: attempt.providerDepositId };
}

const attemptAndOrder = async (attemptId: string) => {
  const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  return { attempt, order: await db().order.findUniqueOrThrow({ where: { id: attempt.orderId } }) };
};

describe("purchases paid through pawaPay", () => {
  it("a sandbox success number is paid only after pawaPay's status check confirms it", async () => {
    const { ready, attemptId, depositId } = await checkoutAndPay("+250783456789");
    await drainJobs();
    let { attempt, order } = await attemptAndOrder(attemptId);
    expect(attempt.state).toBe("PENDING"); // accepted by pawaPay is not paid
    expect(order.state).toBe("AWAITING_PAYMENT");
    const sent = mock.deposits.get(depositId)!;
    expect(sent).toMatchObject({ amount: ready.total, currency: "RWF", phone: "250783456789", provider: "MTN_MOMO_RWA" });

    await settleAndDrain(6);
    ({ attempt, order } = await attemptAndOrder(attemptId));
    expect(attempt.state).toBe("SUCCEEDED");
    expect(order.state).toBe("PAID");
    expect(await db().paymentReceipt.count({ where: { orderId: order.id } })).toBe(1);
    expect(await ledgerMismatches()).toBe(0);
  });

  it("a lost initiation response is looked up, never re-sent under a new id", async () => {
    mock.faults.push({ method: "POST", pathPrefix: "/v2/deposits", fault: "dropAfterAccept" });
    const before = mock.deposits.size;
    const { attemptId, depositId } = await checkoutAndPay("+250783456789");
    await drainJobs();
    for (let i = 0; i < 6; i++) {
      advanceSeconds(130);
      await drainJobs();
    }
    const { attempt, order } = await attemptAndOrder(attemptId);
    expect(attempt.state).toBe("SUCCEEDED");
    expect(order.state).toBe("PAID");
    // Exactly one deposit reached pawaPay, under the attempt's own id.
    expect(mock.deposits.size).toBe(before + 1);
    expect(mock.deposits.has(depositId)).toBe(true);
  });

  it("a declined payment fails with pawaPay's reason and releases the stock", async () => {
    const { attemptId } = await checkoutAndPay("+250783456039"); // sandbox: PAYMENT_NOT_APPROVED
    await drainJobs();
    await settleAndDrain(6);
    const { attempt, order } = await attemptAndOrder(attemptId);
    expect(attempt.state).toBe("FAILED");
    expect(attempt.failureCode).toBe("PAYMENT_NOT_APPROVED");
    expect(order.state).not.toBe("PAID");
  });
});

describe("pawaPay callbacks", () => {
  const callbackUrl = () => `${process.env.APP_ORIGIN!.replace(/\/$/, "")}/api/v1/callbacks/pawapay`;
  const deliver = (signed: { rawBody: Buffer; headers: Headers }) =>
    postCallback(new NextRequest(callbackUrl(), { method: "POST", headers: signed.headers, body: new Uint8Array(signed.rawBody) }), { params: Promise.resolve({}) });

  it("a signed callback is recorded as verified and leads to the status check that pays the order; a forged one is not trusted", async () => {
    const { attemptId, depositId } = await checkoutAndPay("+250783456789");
    await drainJobs();
    const body = { depositId, status: "COMPLETED", amount: "15000.00", currency: "RWF", country: "RWA", created: new Date().toISOString() };

    const forged = mock.signedCallback(callbackUrl(), body);
    const tampered = { rawBody: Buffer.from(forged.rawBody.toString().replace("15000.00", "1.00")), headers: forged.headers };
    // Recorded for the audit trail, refused (pawaPay retries a genuine callback it could not deliver).
    expect((await deliver(tampered)).status).toBe(401);
    expect(await db().providerEvent.count({ where: { signatureStatus: "INVALID" } })).toBe(1);
    expect((await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).state).toBe("PENDING");

    expect((await deliver(mock.signedCallback(callbackUrl(), body))).status).toBe(200);
    expect(await db().providerEvent.count({ where: { signatureStatus: "VERIFIED" } })).toBe(1);
    await drainJobs();
    const { attempt, order } = await attemptAndOrder(attemptId);
    expect(attempt.state).toBe("SUCCEEDED"); // via pawaPay's own status answer
    expect(order.state).toBe("PAID");
  });
});

async function paidOrderAndFinance() {
  const { attemptId, customer, depositId } = await checkoutAndPay("+250783456789");
  await drainJobs();
  await settleAndDrain(6);
  const { order } = await attemptAndOrder(attemptId);
  const receipt = await db().paymentReceipt.findFirstOrThrow({ where: { orderId: order.id } });
  const authUserId = randomUUID();
  const member = await db().staffMember.create({ data: { authUserId, email: `finance-${authUserId.slice(0, 6)}@example.test`, displayName: "Test FINANCE", role: "FINANCE" } });
  const finance = { staffId: member.id, authUserId, role: member.role, displayName: member.displayName, email: member.email, roleVersion: member.roleVersion };
  return { order, receipt, finance, customer, depositId };
}

async function approvedRefund(amount: number | "ALL", before?: (paid: Awaited<ReturnType<typeof paidOrderAndFinance>>) => void) {
  const paid = await paidOrderAndFinance();
  before?.(paid);
  const { order, receipt, finance } = paid;
  const amountRwf = amount === "ALL" ? Number(receipt.verifiedAmountRwf) : amount;
  const requested = await requestRefund(finance, { orderId: order.id, receiptId: receipt.id, amountRwf, reason: "Damaged item" }, `test-${randomUUID()}`, null);
  await decideRefund(finance, requested.id, { expectedVersion: requested.version, decision: "APPROVE", reason: "ok" }, `test-${randomUUID()}`, null);
  return { refund: await db().refund.findUniqueOrThrow({ where: { id: requested.id } }), ...paid };
}

/** A signed pawaPay callback about one of our refunds, delivered to the real route. */
async function deliverRefundCallback(providerRefundId: string, status: "COMPLETED" | "FAILED") {
  const url = `${process.env.APP_ORIGIN!.replace(/\/$/, "")}/api/v1/callbacks/pawapay`;
  const signed = mock.signedCallback(url, { refundId: providerRefundId, status, amount: "5000.00", currency: "RWF", country: "RWA", created: new Date().toISOString() });
  return postCallback(new NextRequest(url, { method: "POST", headers: signed.headers, body: new Uint8Array(signed.rawBody) }), { params: Promise.resolve({}) });
}

/** A refund made at pawaPay without the app (for example from the dashboard). */
function refundOutsideTheApp(depositId: string, amount: number, status: "ACCEPTED" | "COMPLETED") {
  const deposit = mock.deposits.get(depositId)!;
  const id = randomUUID();
  mock.refunds.set(id, { id, kind: "refund", status, amount, currency: "RWF", phone: deposit.phone, provider: deposit.provider, created: new Date().toISOString(), depositId, checks: 0 });
  return mock.refunds.get(id)!;
}

describe("refund outcomes that need finance", () => {
  it("a refund pawaPay reports with a fractional amount is recorded as done but flagged, and the customer is not told an amount", async () => {
    const { refund } = await approvedRefund(5000);
    mock.reportedAmount.set(refund.providerRefundId!, "4999.50");
    for (let i = 0; i < 6; i++) {
      await drainJobs();
      if ((await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).state === "SUCCEEDED") break;
      advanceSeconds(10);
    }
    const done = await db().refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(done).toMatchObject({ state: "SUCCEEDED", verificationFlag: "MISMATCH", providerAmountRwf: null });
    expect(await db().notification.count({ where: { event: "REFUND_CONFIRMED" } })).toBe(0);
  });

  it("a signed 'completed' callback for a refund recorded as failed is flagged, keeps its amount, and finance records what was actually paid", async () => {
    const { refund, order, receipt, finance, customer } = await approvedRefund(5000);
    // A plain definite refusal (no disagreement about the payment): failed, not flagged.
    mock.faults.push({ method: "POST", pathPrefix: "/v2/refunds", fault: "reject:AMOUNT_OUT_OF_BOUNDS" });
    await drainJobs();
    expect(await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ state: "FAILED", failureCode: "AMOUNT_OUT_OF_BOUNDS", verificationFlag: null });
    const collected = Number(receipt.verifiedAmountRwf);
    expect((await receiptView(receipt.id)).remainingRefundableRwf).toBe(collected);

    expect((await deliverRefundCallback(refund.providerRefundId!, "COMPLETED")).status).toBe(200);
    const flagged = await db().refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(flagged).toMatchObject({ state: "FAILED", verificationFlag: "NEEDS_REVIEW" });
    expect(await db().providerEvent.count({ where: { outcome: "CONTRADICTS_FAILED_REFUND" } })).toBe(1);
    // Money may have left: the amount stays reserved, so the same refund cannot be made twice.
    expect((await receiptView(receipt.id)).remainingRefundableRwf).toBe(collected - 5000);
    const tooMuch = await requestRefund(finance, { orderId: order.id, receiptId: receipt.id, amountRwf: collected, reason: "again" }, `test-${randomUUID()}`, null).catch((e: unknown) => e);
    expect(isDomainError(tooMuch) && tooMuch.code).toBe("REFUND_LIMIT");
    // A further refund within what is left goes ahead; the flagged one stays "under review" for the customer.
    const other = await requestRefund(finance, { orderId: order.id, receiptId: receipt.id, amountRwf: 1000, reason: "Goodwill" }, `test-${randomUUID()}`, null);
    await decideRefund(finance, other.id, { expectedVersion: other.version, decision: "APPROVE", reason: "ok" }, `test-${randomUUID()}`, null);
    expect((await getCustomerOrderView(order.id, { guestSession: customer, orderSessionTokens: [] })).refunds.map((r) => r.state)).toEqual(["UNDER_REVIEW", "PENDING"]);

    // Finance finds 3,000 paid back in the dashboard and records exactly that, with the reference.
    const missingRef = await resolveRefundReview(finance, refund.id, { expectedVersion: flagged.version, outcome: "PAID_BY_PROVIDER", reason: "Dashboard shows it completed" }, `test-${randomUUID()}`, null).catch((e: unknown) => e);
    expect(isDomainError(missingRef) && missingRef.code).toBe("VALIDATION_ERROR");
    const tooBig = await resolveRefundReview(finance, refund.id, { expectedVersion: flagged.version, outcome: "PAID_BY_PROVIDER", providerReference: "PP-1", paidAmountRwf: 6000, reason: "x" }, `test-${randomUUID()}`, null).catch((e: unknown) => e);
    expect(isDomainError(tooBig) && tooBig.code).toBe("VALIDATION_ERROR");
    const resolved = await resolveRefundReview(
      finance,
      refund.id,
      { expectedVersion: flagged.version, outcome: "PAID_BY_PROVIDER", providerReference: "PP-3000", paidAmountRwf: 3000, reason: "Dashboard shows 3,000 completed" },
      `test-${randomUUID()}`,
      null,
    );
    expect(resolved).toMatchObject({ state: "SUCCEEDED", verificationFlag: null, amountRwf: 3000 });
    expect(await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ failureCode: null, resolutionReference: "PP-3000" });
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).paymentState).toBe("PARTIALLY_REFUNDED");
    expect((await receiptView(receipt.id)).remainingRefundableRwf).toBe(collected - 3000 - 1000);
    expect((await getStaffOrder(finance, order.id)).refunds.find((r) => r.id === refund.id)).toMatchObject({ resolutionReference: "PP-3000", amountRwf: 3000 });
    expect(await db().notification.count({ where: { event: "REFUND_CONFIRMED", intentKey: refund.id } })).toBe(1);
    const auditRow = await db().auditEvent.findFirstOrThrow({ where: { entityId: refund.id, action: "REFUND_REVIEW_RESOLVED", actorId: finance.staffId } });
    expect(auditRow.beforeSummary).toMatchObject({ amountRwf: 5000, failureCode: "AMOUNT_OUT_OF_BOUNDS" });
    const again = await resolveRefundReview(finance, refund.id, { expectedVersion: resolved.version, outcome: "AS_RECORDED", reason: "x" }, `test-${randomUUID()}`, null).catch((e: unknown) => e);
    expect(isDomainError(again) && again.code).toBe("ACTION_NOT_ALLOWED");
    expect((await opsSummary()).alerts).not.toContain("REFUNDS_NEED_REVIEW");
  });

  it("a 'failed' status check after a verified 'completed' callback is flagged too, whichever arrived first", async () => {
    const { refund } = await approvedRefund(5000);
    await drainJobs(); // accepted: PENDING
    expect((await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).state).toBe("PENDING");
    // pawaPay's status will say FAILED, but a signed callback says COMPLETED first.
    Object.assign(mock.refunds.get(refund.providerRefundId!)!, { status: "FAILED", failureCode: "UNSPECIFIED_FAILURE" });
    expect((await deliverRefundCallback(refund.providerRefundId!, "COMPLETED")).status).toBe(200);
    await settleAndDrain(10);
    expect(await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ state: "FAILED", failureCode: "UNSPECIFIED_FAILURE", verificationFlag: "NEEDS_REVIEW" });
  });

  it("a refusal after a verified 'completed' callback for the same refund is flagged, never a silent failure", async () => {
    const { refund } = await approvedRefund(5000);
    expect((await deliverRefundCallback(refund.providerRefundId!, "COMPLETED")).status).toBe(200); // still QUEUED: only a check is scheduled
    mock.faults.push({ method: "POST", pathPrefix: "/v2/refunds", fault: "reject:AMOUNT_OUT_OF_BOUNDS" });
    await drainJobs();
    expect(await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ state: "FAILED", failureCode: "AMOUNT_OUT_OF_BOUNDS", verificationFlag: "NEEDS_REVIEW" });
    expect(await db().auditEvent.count({ where: { entityId: refund.id, action: "REFUND_FAILED_CONTRADICTED" } })).toBe(1);
  });

  it("a late refusal never fails a refund that a concurrent run already moved on", async () => {
    const { refund } = await approvedRefund(5000);
    // The other run's ACCEPTED lands (refund PENDING) while this run's answer is a refusal.
    class ConcurrentRun extends PawapayPaymentAdapter {
      override async initiateRefund(request: { refundId: string; depositId: string; amountRwf: number }) {
        await db().refund.update({ where: { providerRefundId: request.refundId }, data: { state: "PENDING" } });
        return { kind: "REJECTED" as const, failureCode: "INVALID_AMOUNT", conflict: true };
      }
    }
    setAdaptersForTests({ payments: new ConcurrentRun({ baseUrl: mock.url, apiToken: mock.token, timeoutMs: 2_000 }) });
    await drainJobs();
    expect(await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ state: "PENDING", failureCode: null, verificationFlag: null });
    expect(await db().auditEvent.count({ where: { entityId: refund.id, action: { in: ["REFUND_FAILED", "REFUND_REFUSED_BY_PROVIDER"] } } })).toBe(0);
  });

  it("a payment refunded in full outside the app: the app's refund is refused, flagged, answered as such to 'check now', and recorded by finance as paid", async () => {
    let outside: ReturnType<typeof refundOutsideTheApp> | undefined;
    const { refund, order, finance, customer, receipt, depositId } = await approvedRefund("ALL", (paid) => {
      outside = refundOutsideTheApp(paid.depositId, mock.deposits.get(paid.depositId)!.amount, "COMPLETED");
    });
    const refundPosts = () => mock.requests.filter((r) => r.method === "POST" && r.path === "/v2/refunds").length;
    const before = refundPosts();
    await drainJobs();
    advanceSeconds(600);
    await drainJobs();
    const done = await db().refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(done).toMatchObject({ state: "FAILED", failureCode: "INVALID_STATE", verificationFlag: "NEEDS_REVIEW" });
    // Sent once: a definite refusal is not retried.
    expect(refundPosts() - before).toBe(1);
    expect(await db().auditEvent.count({ where: { entityId: refund.id, action: "REFUND_REFUSED_BY_PROVIDER" } })).toBe(1);
    const staffView = await getStaffOrder(finance, order.id);
    expect(staffView.exceptions).toContain("REFUND_NEEDS_REVIEW");
    expect(staffView.refunds[0]).toMatchObject({ providerRefundId: refund.providerRefundId, failureCode: "INVALID_STATE", resolutionReference: null });
    expect(staffView.receipts[0]!.providerPaymentId).toBe(depositId);
    expect((await getCustomerOrderView(order.id, { guestSession: customer, orderSessionTokens: [] })).refunds.find((r) => r.id === refund.id)?.state).toBe("UNDER_REVIEW");
    const summary = await opsSummary();
    expect(summary.alerts).toContain("REFUNDS_NEED_REVIEW");
    expect(summary.refunds.needsReview).toBe(1);
    expect(await db().notification.count({ where: { event: "REFUND_CONFIRMED" } })).toBe(0);

    const op = await reconcileRefund(finance, refund.id, "Customer asked", `test-${randomUUID()}`, null);
    expect(op).toMatchObject({ state: "FAILED" });
    expect(op.outcome).toMatch(/records for this refund differ/);

    // The dashboard shows the whole payment went back through the outside refund.
    const resolved = await resolveRefundReview(
      finance,
      refund.id,
      { expectedVersion: done.version, outcome: "PAID_BY_PROVIDER", providerReference: outside!.id, reason: "Dashboard: refunded in full from the dashboard on the same day" },
      `test-${randomUUID()}`,
      null,
    );
    expect(resolved).toMatchObject({ state: "SUCCEEDED", verificationFlag: null, amountRwf: Number(receipt.verifiedAmountRwf) });
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).paymentState).toBe("REFUNDED");
    expect((await receiptView(receipt.id)).remainingRefundableRwf).toBe(0);
    expect((await getCustomerOrderView(order.id, { guestSession: customer, orderSessionTokens: [] })).refunds.map((r) => r.state)).toEqual(["SUCCEEDED"]);
    expect((await getStaffOrder(finance, order.id)).exceptions).not.toContain("REFUND_NEEDS_REVIEW");
    expect((await opsSummary()).alerts).not.toContain("REFUNDS_NEED_REVIEW");
  });

  it("a refusal where the records disagree, then the order is cancelled: the case takes on the cancellation, and 'records match' releases the money back into it", async () => {
    const { refund, order, finance, receipt } = await approvedRefund(5000);
    mock.faults.push({ method: "POST", pathPrefix: "/v2/refunds", fault: "reject:INVALID_AMOUNT" });
    await drainJobs();
    const flagged = await db().refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(flagged).toMatchObject({ state: "FAILED", failureCode: "INVALID_AMOUNT", verificationFlag: "NEEDS_REVIEW" });
    // The staff-request case stays open while the review is open (the refund is not final).
    expect(await db().refundCase.findUniqueOrThrow({ where: { id: refund.caseId } })).toMatchObject({ state: "OPEN", source: "STAFF_REQUEST" });

    const authUserId = randomUUID();
    const member = await db().staffMember.create({ data: { authUserId, email: `admin-${authUserId.slice(0, 6)}@example.test`, displayName: "Test ADMIN", role: "ADMIN" } });
    const admin = { staffId: member.id, authUserId, role: member.role, displayName: member.displayName, email: member.email, roleVersion: member.roleVersion };
    const current = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    await applyOrderCommand(admin, order.id, { action: "CANCEL", expectedVersion: current.version, reason: "Customer asked" } as OrderCommand, `test-${randomUUID()}`, null);
    // The customer is now owed the whole payment: the open case takes on that purpose.
    expect(await db().refundCase.count({ where: { receiptId: receipt.id, state: "OPEN" } })).toBe(1);
    expect(await db().refundCase.findUniqueOrThrow({ where: { id: refund.caseId } })).toMatchObject({ state: "OPEN", source: "CANCELLATION" });

    // The dashboard shows nothing was refunded: the record is right, the money is still owed.
    await resolveRefundReview(finance, refund.id, { expectedVersion: flagged.version, outcome: "AS_RECORDED", reason: "Dashboard: no refund of this payment" }, `test-${randomUUID()}`, null);
    expect((await receiptView(receipt.id)).remainingRefundableRwf).toBe(Number(receipt.verifiedAmountRwf));
    expect(await db().refundCase.findUniqueOrThrow({ where: { id: refund.caseId } })).toMatchObject({ state: "OPEN", source: "CANCELLATION" });
    const sweep = await reconciliationSweep();
    expect(sweep.checks.find((c) => c.code === "COLLECTION_WITHOUT_REFUND_PATH")?.count).toBe(0);
  });

  it("an access refusal (wrong token) keeps the refund with the provider and retries it, unflagged, until access works", async () => {
    const { refund } = await approvedRefund(5000);
    setAdaptersForTests({ payments: new PawapayPaymentAdapter({ baseUrl: mock.url, apiToken: "rotated-or-mistyped", timeoutMs: 2_000 }) });
    await drainJobs();
    expect(await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ state: "SUBMITTED", verificationFlag: null, failureCode: null });
    expect((await db().outboxJob.findFirstOrThrow({ where: { entityId: refund.id, type: "REFUND_SUBMIT" } })).lastErrorCode).toBe("REFUND_PROVIDER_ACCESS");
    setAdaptersForTests({ payments: new PawapayPaymentAdapter({ baseUrl: mock.url, apiToken: mock.token, timeoutMs: 2_000 }) });
    for (let i = 0; i < 6; i++) {
      advanceSeconds(310);
      await drainJobs();
      if ((await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).state === "SUCCEEDED") break;
    }
    expect(await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ state: "SUCCEEDED", verificationFlag: null });
  });
});

describe("a refund while pawaPay is still processing another for the same payment", () => {
  it("is flagged once, retried under the same id, and a review finance closed is not reopened by the next retry", async () => {
    let outside: ReturnType<typeof refundOutsideTheApp> | undefined;
    const { refund, order, finance, customer } = await approvedRefund(5000, (paid) => {
      outside = refundOutsideTheApp(paid.depositId, 1000, "ACCEPTED");
    });
    await drainJobs();
    // pawaPay answered INVALID_STATE "already in progress" although the app had nothing else in
    // flight: kept with the provider (not failed) and flagged.
    const flagged = await db().refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(flagged).toMatchObject({ state: "SUBMITTED", verificationFlag: "NEEDS_REVIEW" });
    expect(mock.refunds.has(refund.providerRefundId!)).toBe(false);
    expect((await db().outboxJob.findFirstOrThrow({ where: { entityId: refund.id, type: "REFUND_SUBMIT" } })).lastErrorCode).toBe("REFUND_PROVIDER_BUSY");
    expect(await db().auditEvent.count({ where: { entityId: refund.id, action: "REFUND_PROVIDER_BUSY_OUTSIDE_APP" } })).toBe(1);
    const paidOut = await resolveRefundReview(finance, refund.id, { expectedVersion: flagged.version, outcome: "PAID_BY_PROVIDER", providerReference: "x", reason: "x" }, `test-${randomUUID()}`, null).catch((e: unknown) => e);
    expect(isDomainError(paidOut) && paidOut.code).toBe("ACTION_NOT_ALLOWED");

    // Finance sees the other refund is a separate one and closes the review while pawaPay is still busy.
    await resolveRefundReview(finance, refund.id, { expectedVersion: flagged.version, outcome: "AS_RECORDED", reason: "The other refund is a separate goodwill refund" }, `test-${randomUUID()}`, null);
    advanceSeconds(310);
    await drainJobs(); // still "in progress": retried, not flagged again
    expect(await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ state: "SUBMITTED", verificationFlag: null });
    expect(await db().auditEvent.count({ where: { entityId: refund.id, action: "REFUND_PROVIDER_BUSY_OUTSIDE_APP" } })).toBe(1);

    outside!.status = "COMPLETED";
    for (let i = 0; i < 8; i++) {
      advanceSeconds(310);
      await drainJobs();
      if ((await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).state === "SUCCEEDED") break;
    }
    expect(await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ state: "SUCCEEDED", verificationFlag: null });
    expect(mock.refunds.get(refund.providerRefundId!)).toMatchObject({ amount: 5000, status: "COMPLETED" });
    // Never a second refund id from the app.
    const ours = [...mock.refunds.values()].filter((r) => r.depositId === outside!.depositId && r.id !== outside!.id);
    expect(ours).toHaveLength(1);
    expect((await getCustomerOrderView(order.id, { guestSession: customer, orderSessionTokens: [] })).refunds.map((r) => r.state)).toEqual(["SUCCEEDED"]);
  });
});

describe("refunds through pawaPay", () => {
  it("an approved refund is sent once, with its own id, and completes from pawaPay's status check", async () => {
    const { attemptId } = await checkoutAndPay("+250783456789");
    await drainJobs();
    await settleAndDrain(6);
    const { order } = await attemptAndOrder(attemptId);
    expect(order.state).toBe("PAID");
    const receipt = await db().paymentReceipt.findFirstOrThrow({ where: { orderId: order.id } });
    const authUserId = randomUUID();
    const member = await db().staffMember.create({ data: { authUserId, email: `finance-${authUserId.slice(0, 6)}@example.test`, displayName: "Test FINANCE", role: "FINANCE" } });
    const finance = { staffId: member.id, authUserId, role: member.role, displayName: member.displayName, email: member.email, roleVersion: member.roleVersion };

    const refund = await requestRefund(finance, { orderId: order.id, receiptId: receipt.id, amountRwf: 5000, reason: "Damaged item" }, `test-${randomUUID()}`, null);
    await decideRefund(finance, refund.id, { expectedVersion: refund.version, decision: "APPROVE", reason: "ok" }, `test-${randomUUID()}`, null);
    for (let i = 0; i < 6; i++) {
      await drainJobs();
      if ((await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).state === "SUCCEEDED") break;
      advanceSeconds(10);
    }
    const done = await db().refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(done.state).toBe("SUCCEEDED");
    const sent = mock.refunds.get(done.providerRefundId!)!;
    expect(sent).toMatchObject({ amount: 5000, currency: "RWF", status: "COMPLETED" });
    expect([...mock.refunds.values()].filter((r) => r.depositId === sent.depositId)).toHaveLength(1);
  });
});
