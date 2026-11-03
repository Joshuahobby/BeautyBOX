import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { db } from "@/server/db";
import { setAdaptersForTests } from "@/adapters/registry";
import { FakePaymentAdapter } from "@/adapters/payments/fake";
import type { InitiationResult, RefundRequest } from "@/adapters/payments/types";
import { FakeSmsAdapter } from "@/adapters/sms/fake";
import type { SmsAdapter, SmsSendResult } from "@/adapters/sms/types";
import { claimDueJobs } from "@/modules/jobs/outbox";
import { applyOrderCommand, type OrderCommand } from "@/modules/fulfillment/commands";
import { decideRefund, requestRefund } from "@/modules/refunds/refunds";
import { getCustomerOrderView } from "@/modules/orders/customer-views";
import { getStaffOrder } from "@/modules/orders/staff-views";
import type { StaffIdentity } from "@/modules/staff/identity";
import { GUEST_COOKIE } from "@/modules/session/guest-session";
import { ORDER_COOKIE_PREFIX } from "@/modules/orders/access";
import { POST as postCommand } from "@/app/api/v1/staff/orders/[orderId]/commands/route";
import { POST as postReissue } from "@/app/api/v1/staff/orders/[orderId]/access-links/route";
import { POST as postRefundReconcile } from "@/app/api/v1/staff/refunds/[refundId]/reconcile/route";
import { POST as postPaymentReconcile } from "@/app/api/v1/staff/payments/[attemptId]/reconcile/route";
import { GET as getExceptions } from "@/app/api/v1/staff/payment-exceptions/route";
import { GET as getStaffOperation } from "@/app/api/v1/staff/operations/[operationId]/route";
import { POST as postExchange } from "@/app/api/v1/order-access/exchange/route";
import { POST as postCancellation } from "@/app/api/v1/orders/[orderId]/cancellation-requests/route";
import { POST as postOwnerLink } from "@/app/api/v1/orders/[orderId]/access-link/route";
import { GET as getOperation } from "@/app/api/v1/operations/[operationId]/route";
import { GET as getOrder } from "@/app/api/v1/orders/[orderId]/route";
import {
  PHONES,
  addToCart,
  advanceSeconds,
  drainJobs,
  expectDomainError,
  ledgerMismatches,
  lotTotals,
  newCustomer,
  pay,
  readyCheckout,
  resetDatabase,
  seedShop,
  settleAndDrain,
  type Shop,
} from "./harness";

// I09 fulfilment and cancellation (T09, AT11), I10 refunds (T11, T12) and payment
// reconciliation, I11 private order access (T15) and SMS failure (T19). Real PostgreSQL,
// real route handlers and domain modules; only providers are the deterministic fakes.

let shop: Shop;
let sms: FakeSmsAdapter;

beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
  sms = new FakeSmsAdapter();
  setAdaptersForTests({ sms });
});

type Role = "ADMIN" | "OPERATIONS" | "FINANCE" | "SUPPORT";

async function staff(role: Role): Promise<StaffIdentity & { header: string }> {
  const authUserId = randomUUID();
  const m = await db().staffMember.create({
    data: { authUserId, email: `${role.toLowerCase()}-${authUserId.slice(0, 6)}@example.test`, displayName: `Test ${role}`, role },
  });
  return { staffId: m.id, authUserId, role: m.role, displayName: m.displayName, email: m.email, roleVersion: m.roleVersion, header: `${authUserId}:aal2` };
}

function req(method: string, path: string, opts: { staff?: string; cookies?: Record<string, string>; body?: unknown; key?: string } = {}) {
  const origin = process.env.APP_ORIGIN!;
  const headers: Record<string, string> = { origin };
  if (opts.staff) headers["x-test-staff"] = opts.staff;
  if (opts.cookies && Object.keys(opts.cookies).length > 0) headers.cookie = Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (method !== "GET") {
    headers["content-type"] = "application/json";
    headers["idempotency-key"] = opts.key ?? `test-${randomUUID()}`;
  }
  return new NextRequest(`${origin}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

const params = <P extends Record<string, string>>(p: P) => ({ params: Promise.resolve(p) });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });
// Both link forms: SMS (/o#<token>, DR-049) and browser (/order-access#token=<token>).
const tokenIn = (text: string) => /(?:#token=|\/o#)([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? null;
/** The order confirmation the fake SMS adapter "sent", found by its notification (not its wording). */
const confirmationSms = async (orderId: string) => {
  const n = await db().notification.findFirstOrThrow({ where: { orderId, event: "ORDER_CONFIRMED" } });
  return sms.sent.find((m) => m.messageIntentId === n.id);
};

async function paidOrder(qty = 1) {
  const customer = await newCustomer();
  await addToCart(customer, shop.cleanser.id, qty);
  const ready = await readyCheckout(customer);
  const { attemptId } = await pay(customer, ready);
  await drainJobs();
  await settleAndDrain(6);
  const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const order = await db().order.findUniqueOrThrow({ where: { id: attempt.orderId } });
  expect(order.state).toBe("PAID");
  return { customer, order, attemptId, total: ready.total };
}

const currentOrder = (id: string) => db().order.findUniqueOrThrow({ where: { id } });

async function command(actor: StaffIdentity, orderId: string, cmd: Omit<OrderCommand, "expectedVersion"> & Record<string, unknown>) {
  const order = await currentOrder(orderId);
  await applyOrderCommand(actor, orderId, { ...cmd, expectedVersion: order.version } as OrderCommand, `test-${randomUUID()}`, null);
}

async function readyForHandover(ops: StaffIdentity, orderId: string) {
  await command(ops, orderId, { action: "START_PREPARATION", reason: "Packed" });
  await command(ops, orderId, { action: "ASSIGN_RIDER", reason: "Rider booked", riderReference: "RIDER-7" });
}

// ---------------------------------------------------------------- I09 fulfilment

describe("I09 fulfilment commands", () => {
  it("moves a paid order through preparation, rider handover and delivery; stock leaves only at handover", async () => {
    const ops = await staff("OPERATIONS");
    const { order } = await paidOrder();
    const paid = await lotTotals(shop.cleanser.id);

    let res = await json(await postCommand(req("POST", `/api/v1/staff/orders/${order.id}/commands`, { staff: ops.header, body: { action: "START_PREPARATION", expectedVersion: order.version, reason: "Packed and checked" } }), params({ orderId: order.id })));
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("PREPARING");
    res = await json(await postCommand(req("POST", `/api/v1/staff/orders/${order.id}/commands`, { staff: ops.header, body: { action: "ASSIGN_RIDER", expectedVersion: res.body.version, reason: "Booked", riderReference: "RIDER-7" } }), params({ orderId: order.id })));
    expect(res.body.riderReference).toBe("RIDER-7");
    expect(await lotTotals(shop.cleanser.id)).toEqual(paid);

    // Handover only to the assigned rider.
    res = await json(await postCommand(req("POST", `/api/v1/staff/orders/${order.id}/commands`, { staff: ops.header, body: { action: "HAND_OVER", expectedVersion: res.body.version, reason: "Collected", riderReference: "SOMEONE-ELSE", occurredAt: new Date().toISOString() } }), params({ orderId: order.id })));
    expect(res.status).toBe(409);
    const version = (await currentOrder(order.id)).version;
    res = await json(await postCommand(req("POST", `/api/v1/staff/orders/${order.id}/commands`, { staff: ops.header, body: { action: "HAND_OVER", expectedVersion: version, reason: "Collected", riderReference: "RIDER-7", occurredAt: new Date().toISOString() } }), params({ orderId: order.id })));
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("DISPATCHED");
    expect(res.body.allocationState).toBe("SHIPPED");
    expect(await lotTotals(shop.cleanser.id)).toEqual({ onHand: paid.onHand - 1, reserved: 0, committed: paid.committed - 1 });

    await command(ops, order.id, { action: "CONFIRM_DELIVERY", reason: "Delivered", occurredAt: new Date().toISOString(), confirmationReference: "Signed by recipient" });
    expect((await currentOrder(order.id)).state).toBe("DELIVERED");
    expect(await db().notification.count({ where: { orderId: order.id, event: "ORDER_DISPATCHED" } })).toBe(1);
    expect(await ledgerMismatches()).toBe(0);
  });

  it("T09: cancellation racing handover has exactly one winner; the loser gets a version conflict", async () => {
    const ops = await staff("OPERATIONS");
    const outcomes = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const { order } = await paidOrder();
      await readyForHandover(ops, order.id);
      const before = await lotTotals(shop.cleanser.id);
      const { version } = await currentOrder(order.id);
      const cancel = () => applyOrderCommand(ops, order.id, { action: "CANCEL", expectedVersion: version, reason: "Customer asked" }, `test-${randomUUID()}`, null);
      const handover = () => applyOrderCommand(ops, order.id, { action: "HAND_OVER", expectedVersion: version, reason: "Collected", riderReference: "RIDER-7", occurredAt: new Date().toISOString() }, `test-${randomUUID()}`, null);
      // Alternate which command reaches the database first, so both winners are exercised.
      const [c, h] = i % 2 === 0 ? await Promise.allSettled([cancel(), handover()]) : (await Promise.allSettled([handover(), cancel()])).reverse();
      const fulfilled = [c, h].filter((r) => r!.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);
      const loser = [c, h].find((r) => r!.status === "rejected") as PromiseRejectedResult;
      expect((loser.reason as { code: string }).code).toBe("VERSION_CONFLICT");

      const after = await currentOrder(order.id);
      const totals = await lotTotals(shop.cleanser.id);
      if (c!.status === "fulfilled") {
        outcomes.add("cancel");
        expect(after.state).toBe("CANCELLED");
        // Committed stock returns to availability; nothing left the shelf.
        expect(totals).toEqual({ onHand: before.onHand, reserved: 0, committed: before.committed - 1 });
        // The receipt is kept and a refund case is opened for the collected money.
        expect(await db().paymentReceipt.count({ where: { orderId: order.id } })).toBe(1);
        expect(await db().refundCase.count({ where: { orderId: order.id, source: "CANCELLATION", state: "OPEN" } })).toBe(1);
      } else {
        outcomes.add("handover");
        expect(after.state).toBe("DISPATCHED");
        expect(totals).toEqual({ onHand: before.onHand - 1, reserved: 0, committed: before.committed - 1 });
        expect(await db().refundCase.count({ where: { orderId: order.id } })).toBe(0);
      }
    }
    expect([...outcomes].sort()).toEqual(["cancel", "handover"]);
    expect(await ledgerMismatches()).toBe(0);
  });

  it("AT11: cancelling before payment is verified releases stock; a later success is refunded, never revived", async () => {
    const ops = await staff("OPERATIONS");
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 2);
    const { attemptId } = await pay(customer, await readyCheckout(customer));
    await drainJobs(); // initiation accepted; the deposit settles later
    const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect((await currentOrder(attempt.orderId)).state).toBe("AWAITING_PAYMENT");
    await command(ops, attempt.orderId, { action: "CANCEL", reason: "Customer changed mind" });
    expect(await lotTotals(shop.cleanser.id)).toMatchObject({ reserved: 0, committed: 0 });

    await settleAndDrain(6);
    const order = await currentOrder(attempt.orderId);
    expect(order.state).toBe("CANCELLED");
    const receipts = await db().paymentReceipt.findMany({ where: { orderId: order.id } });
    expect(receipts.map((r) => r.disposition)).toEqual(["AFTER_CANCELLATION"]);
    expect(await db().refundCase.count({ where: { orderId: order.id, state: "OPEN" } })).toBe(1);
    expect(await lotTotals(shop.cleanser.id)).toMatchObject({ reserved: 0, committed: 0 });
    await expectDomainError(command(ops, order.id, { action: "START_PREPARATION", reason: "try" }), "ACTION_NOT_ALLOWED");
  });

  it("a staff hold blocks preparation until it is resumed", async () => {
    const ops = await staff("OPERATIONS");
    const { order } = await paidOrder();
    await command(ops, order.id, { action: "HOLD", reason: "Checking the address with the customer" });
    expect(await currentOrder(order.id)).toMatchObject({ state: "ON_HOLD", holdReason: "MANUAL" });
    await expectDomainError(command(ops, order.id, { action: "ASSIGN_RIDER", reason: "x", riderReference: "R" }), "ACTION_NOT_ALLOWED");
    await command(ops, order.id, { action: "START_PREPARATION", reason: "Address confirmed" });
    expect(await currentOrder(order.id)).toMatchObject({ state: "PREPARING", holdReason: null });
  });

  it("enforces roles for fulfilment and cancellation, and audits the denial", async () => {
    const support = await staff("SUPPORT");
    const finance = await staff("FINANCE");
    const { order } = await paidOrder();
    let res = await postCommand(req("POST", `/api/v1/staff/orders/${order.id}/commands`, { staff: support.header, body: { action: "START_PREPARATION", expectedVersion: order.version, reason: "x" } }), params({ orderId: order.id }));
    expect(res.status).toBe(403);
    res = await postCommand(req("POST", `/api/v1/staff/orders/${order.id}/commands`, { staff: finance.header, body: { action: "CANCEL", expectedVersion: order.version, reason: "x" } }), params({ orderId: order.id }));
    expect(res.status).toBe(403);
    expect(await db().auditEvent.count({ where: { action: "CAPABILITY_DENIED" } })).toBe(2);
    expect((await currentOrder(order.id)).state).toBe("PAID");
  });

  it("a customer cancellation request is only a request: staff cancel resolves it, a handover declines it", async () => {
    const ops = await staff("OPERATIONS");
    const first = await paidOrder();
    const cookies = { [GUEST_COOKIE]: first.customer.token };
    const body = { expectedVersion: first.order.version, reason: "Ordered the wrong size" };
    const r1 = await json(await postCancellation(req("POST", `/api/v1/orders/${first.order.id}/cancellation-requests`, { cookies, body }), params({ orderId: first.order.id })));
    expect(r1.status).toBe(202);
    expect(r1.body).toMatchObject({ state: "PENDING", type: "CANCELLATION_REQUEST", statusUrl: `/api/v1/operations/${r1.body.id}` });
    expect((await currentOrder(first.order.id)).state).toBe("PAID");
    // A repeat request (new key) returns the same pending request.
    const r2 = await json(await postCancellation(req("POST", `/api/v1/orders/${first.order.id}/cancellation-requests`, { cookies, body }), params({ orderId: first.order.id })));
    expect(r2.body.id).toBe(r1.body.id);
    // Another visitor cannot see it or ask on the order's behalf.
    const stranger = await newCustomer();
    expect((await getOperation(req("GET", `/api/v1/operations/${r1.body.id}`, { cookies: { [GUEST_COOKIE]: stranger.token } }), params({ operationId: String(r1.body.id) }))).status).toBe(404);
    expect((await postCancellation(req("POST", `/api/v1/orders/${first.order.id}/cancellation-requests`, { cookies: { [GUEST_COOKIE]: stranger.token }, body }), params({ orderId: first.order.id }))).status).toBe(404);

    const staffView = await getStaffOrder(ops, first.order.id);
    expect(staffView.exceptions).toContain("CANCELLATION_REQUESTED");
    await command(ops, first.order.id, { action: "CANCEL", reason: "Customer request before packing" });
    const resolved = await json(await getOperation(req("GET", `/api/v1/operations/${r1.body.id}`, { cookies }), params({ operationId: String(r1.body.id) })));
    expect(resolved.body.state).toBe("SUCCEEDED");
    const view = await getCustomerOrderView(first.order.id, { guestSession: first.customer, orderSessionTokens: [] });
    expect(view.cancellationRequest?.state).toBe("SUCCEEDED");
    expect(view.canRequestCancellation).toBe(false);

    // Second order: the handover wins and the waiting request is declined.
    const second = await paidOrder();
    const cookies2 = { [GUEST_COOKIE]: second.customer.token };
    await readyForHandover(ops, second.order.id);
    const { version } = await currentOrder(second.order.id);
    const req2 = await json(await postCancellation(req("POST", `/api/v1/orders/${second.order.id}/cancellation-requests`, { cookies: cookies2, body: { expectedVersion: version, reason: "Too slow" } }), params({ orderId: second.order.id })));
    expect(req2.status).toBe(202);
    await command(ops, second.order.id, { action: "HAND_OVER", reason: "Collected", riderReference: "RIDER-7", occurredAt: new Date().toISOString() });
    const declined = await db().operation.findUniqueOrThrow({ where: { id: String(req2.body.id) } });
    expect(declined.state).toBe("FAILED");
    expect((await currentOrder(second.order.id)).state).toBe("DISPATCHED");
    // After handover a new request is refused with a pointer to support.
    const late = await json(await postCancellation(req("POST", `/api/v1/orders/${second.order.id}/cancellation-requests`, { cookies: cookies2, body: { expectedVersion: (await currentOrder(second.order.id)).version, reason: "Again" } }), params({ orderId: second.order.id })));
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("ACTION_NOT_ALLOWED");
  });
});

// ---------------------------------------------------------------- I10 refunds and reconciliation

const inFlight = (receiptId: string) => db().refund.count({ where: { receiptId, state: { in: ["SUBMITTED", "PENDING"] } } });

describe("I10 refunds", () => {
  it("T11: concurrent approvals cannot exceed the collection; refunds go to the provider one at a time", async () => {
    const finance = await staff("FINANCE");
    const { order, total } = await paidOrder();
    expect(total).toBe(17100);
    const receipt = await db().paymentReceipt.findFirstOrThrow({ where: { orderId: order.id } });
    const a = await requestRefund(finance, { orderId: order.id, receiptId: receipt.id, amountRwf: 16000, reason: "Damaged item" }, `test-${randomUUID()}`, null);
    const b = await requestRefund(finance, { orderId: order.id, receiptId: receipt.id, amountRwf: 2000, reason: "Delivery delay" }, `test-${randomUUID()}`, null);
    const results = await Promise.allSettled([
      decideRefund(finance, a.id, { expectedVersion: a.version, decision: "APPROVE", reason: "ok" }, `test-${randomUUID()}`, null),
      decideRefund(finance, b.id, { expectedVersion: b.version, decision: "APPROVE", reason: "ok" }, `test-${randomUUID()}`, null),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as { code: string }).code).toBe("REFUND_LIMIT");
    const winner = results[0]!.status === "fulfilled" ? a : b;
    const remainder = 17100 - winner.amountRwf;
    const c = await requestRefund(finance, { orderId: order.id, receiptId: receipt.id, amountRwf: remainder, reason: "Rest of the payment" }, `test-${randomUUID()}`, null);
    await decideRefund(finance, c.id, { expectedVersion: c.version, decision: "APPROVE", reason: "ok" }, `test-${randomUUID()}`, null);
    // Anything more is refused: the full collection is now reserved.
    await expectDomainError(requestRefund(finance, { orderId: order.id, receiptId: receipt.id, amountRwf: 1, reason: "extra" }, `test-${randomUUID()}`, null), "REFUND_LIMIT");

    for (let i = 0; i < 12; i++) {
      await drainJobs();
      expect(await inFlight(receipt.id)).toBeLessThanOrEqual(1);
      const open = await db().refund.count({ where: { receiptId: receipt.id, state: { in: ["QUEUED", "SUBMITTED", "PENDING"] } } });
      if (open === 0) break;
      advanceSeconds(31);
    }
    const refunds = await db().refund.findMany({ where: { receiptId: receipt.id, state: "SUCCEEDED" } });
    expect(refunds.reduce((n, r) => n + Number(r.amountRwf), 0)).toBe(17100);
    expect((await currentOrder(order.id)).paymentState).toBe("REFUNDED");
    const devsim = await db().$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM devsim.refunds`;
    expect(Number(devsim[0]!.n)).toBe(2);
    expect(await db().notification.count({ where: { orderId: order.id, event: "REFUND_CONFIRMED" } })).toBe(2);
  });

  it("T12: a refund whose submission timed out is looked up, not resent, across repeated clicks and a worker restart", async () => {
    class LostRefundResponse extends FakePaymentAdapter {
      calls = 0;
      override async initiateRefund(request: RefundRequest): Promise<InitiationResult> {
        this.calls++;
        const result = await super.initiateRefund(request);
        return this.calls === 1 ? { kind: "UNKNOWN", reason: "timeout" } : result;
      }
    }
    const provider = new LostRefundResponse();
    setAdaptersForTests({ sms, payments: provider });
    const finance = await staff("FINANCE");
    const { order } = await paidOrder();
    const receipt = await db().paymentReceipt.findFirstOrThrow({ where: { orderId: order.id } });
    const refund = await requestRefund(finance, { orderId: order.id, receiptId: receipt.id, amountRwf: 5000, reason: "Partial" }, `test-${randomUUID()}`, null);
    const approved = await decideRefund(finance, refund.id, { expectedVersion: refund.version, decision: "APPROVE", reason: "ok" }, `test-${randomUUID()}`, null);
    await drainJobs();
    expect((await db().refund.findUniqueOrThrow({ where: { id: refund.id } })).state).toBe("SUBMITTED");

    // Staff click "check now" three times.
    const ops = [];
    for (let i = 0; i < 3; i++) {
      const res = await json(await postRefundReconcile(req("POST", `/api/v1/staff/refunds/${refund.id}/reconcile`, { staff: finance.header, body: { reason: "Customer asked" } }), params({ refundId: refund.id })));
      expect(res.status).toBe(202);
      ops.push(res.body.id);
    }
    expect(new Set(ops).size).toBe(1);

    // The submit worker dies holding the job; its lease expires and another worker recovers.
    advanceSeconds(400);
    const job = await db().outboxJob.findFirstOrThrow({ where: { type: "REFUND_SUBMIT" } });
    await claimDueJobs({ batchSize: 1, leaseSeconds: 60, owner: "doomed", onlyJobId: job.id });
    advanceSeconds(61);
    for (let i = 0; i < 4; i++) {
      await drainJobs();
      advanceSeconds(30);
    }

    const done = await db().refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(done.state).toBe("SUCCEEDED");
    expect(done.providerRefundId).toBe(approved.providerRefundId);
    const devsim = await db().$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM devsim.refunds`;
    expect(Number(devsim[0]!.n)).toBe(1);
    expect(provider.calls).toBe(1);
    const op = await json(await getStaffOperation(req("GET", `/api/v1/staff/operations/${ops[0]}`, { staff: finance.header }), params({ operationId: String(ops[0]) })));
    expect(op.body.state).toBe("SUCCEEDED");
    expect((await currentOrder(order.id)).paymentState).toBe("PARTIALLY_REFUNDED");
  });

  it("payment reconcile looks up the existing deposit, never a new one; delayed deposits show as exceptions", async () => {
    const finance = await staff("FINANCE");
    const support = await staff("SUPPORT");
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const { attemptId } = await pay(customer, await readyCheckout(customer), { phone: PHONES.neverSettles });
    await drainJobs();
    const res = await json(await postPaymentReconcile(req("POST", `/api/v1/staff/payments/${attemptId}/reconcile`, { staff: finance.header, body: { reason: "Customer says debited" } }), params({ attemptId })));
    expect(res.status).toBe(202);
    expect(res.body.state).toBe("PENDING");
    await drainJobs();
    const op = await db().operation.findUniqueOrThrow({ where: { id: String(res.body.id) } });
    expect(op.state).toBe("SUCCEEDED");
    expect(op.outcome).toMatch(/pending/i);
    const deposits = await db().$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM devsim.deposits`;
    expect(Number(deposits[0]!.n)).toBe(1);

    advanceSeconds(11 * 60);
    const list = await json(await getExceptions(req("GET", "/api/v1/staff/payment-exceptions", { staff: finance.header }), params({})));
    expect((list.body.items as { attemptId: string; code: string }[]).find((i) => i.attemptId === attemptId)?.code).toBe("DELAYED_UNRESOLVED");
    expect((await getExceptions(req("GET", "/api/v1/staff/payment-exceptions", { staff: support.header }), params({}))).status).toBe(403);
  });
});

// ---------------------------------------------------------------- I11 private order access

async function exchange(token: string, cookies: Record<string, string> = {}) {
  const res = (await postExchange(req("POST", "/api/v1/order-access/exchange", { cookies, body: { token } }), params({}))) as NextResponse;
  const set = res.cookies.getAll().find((c) => c.name.startsWith(ORDER_COOKIE_PREFIX));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cookie: set ? { name: set.name, value: set.value } : null };
}

const jar = (c: { name: string; value: string } | null) => (c ? { [c.name]: c.value } : {});
const viewOrder = (orderId: string, cookies: Record<string, string>) => getOrder(req("GET", `/api/v1/orders/${orderId}`, { cookies }), params({ orderId }));

describe("I11 private order access", () => {
  it("T15: the confirmation SMS carries a one-time link that becomes an order session", async () => {
    const { order } = await paidOrder();
    const message = await confirmationSms(order.id);
    expect(message?.recipientE164).toBe("+250788555111"); // the order contact, not the payer number
    // The short SMS form, last in the message: 32 random bytes on the page /o (DR-049).
    expect(message!.text.endsWith(`${process.env.APP_ORIGIN}/o#${tokenIn(message!.text)}`)).toBe(true);
    const token = tokenIn(message!.text)!;
    expect(token).toHaveLength(43);
    // Only a hash is stored.
    expect(await db().privateOrderLink.count({ where: { tokenHash: token } })).toBe(0);

    const first = await exchange(token);
    expect(first.status).toBe(200);
    expect(first.body.orderId).toBe(order.id);
    expect(first.cookie).toBeTruthy();
    expect((await viewOrder(order.id, jar(first.cookie))).status).toBe(200);

    // Used again in another browser: refused, same answer as a made-up token.
    const reused = await exchange(token);
    const madeUp = await exchange("x".repeat(43));
    expect(reused.status).toBe(404);
    expect(madeUp.status).toBe(404);
    expect(reused.body.message).toBe(madeUp.body.message);
    // Used again in the browser that already has access: it simply continues.
    const again = await exchange(token, jar(first.cookie));
    expect(again.status).toBe(200);
    expect(again.cookie).toBeNull();

    // An order session never opens another order.
    const other = await paidOrder();
    expect((await viewOrder(other.order.id, jar(first.cookie))).status).toBe(404);
  });

  it("T15: an expired link explains itself; the owner can create a link only for a paid order", async () => {
    const { order, customer } = await paidOrder();
    const stranger = await newCustomer();
    expect((await postOwnerLink(req("POST", `/api/v1/orders/${order.id}/access-link`, { cookies: { [GUEST_COOKIE]: stranger.token } }), params({ orderId: order.id }))).status).toBe(404);
    const created = await json(await postOwnerLink(req("POST", `/api/v1/orders/${order.id}/access-link`, { cookies: { [GUEST_COOKIE]: customer.token } }), params({ orderId: order.id })));
    expect(created.status).toBe(201);
    const token = tokenIn(String(created.body.url))!;
    advanceSeconds(7 * 24 * 60 * 60 + 1);
    const expired = await exchange(token);
    expect(expired.status).toBe(404);
    expect(String(expired.body.message)).toMatch(/expired/);

    const unpaidCustomer = await newCustomer();
    await addToCart(unpaidCustomer, shop.cleanser.id, 1);
    const { attemptId } = await pay(unpaidCustomer, await readyCheckout(unpaidCustomer), { phone: PHONES.neverSettles });
    const unpaid = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const refused = await json(await postOwnerLink(req("POST", `/api/v1/orders/${unpaid.orderId}/access-link`, { cookies: { [GUEST_COOKIE]: unpaidCustomer.token } }), params({ orderId: unpaid.orderId })));
    expect(refused.status).toBe(409);
  });

  it("T15: a support reissue revokes earlier links and sessions and sends a fresh link to the order contact", async () => {
    const support = await staff("SUPPORT");
    const { order, customer } = await paidOrder();
    const session = await exchange(tokenIn((await confirmationSms(order.id))!.text)!);
    const spare = await json(await postOwnerLink(req("POST", `/api/v1/orders/${order.id}/access-link`, { cookies: { [GUEST_COOKIE]: customer.token } }), params({ orderId: order.id })));
    const spareToken = tokenIn(String(spare.body.url))!;

    const current = await currentOrder(order.id);
    const res = await json(await postReissue(req("POST", `/api/v1/staff/orders/${order.id}/access-links`, { staff: support.header, body: { expectedVersion: current.version, verificationCaseReference: "CASE-104", reason: "Customer lost the message" } }), params({ orderId: order.id })));
    expect(res.status).toBe(202);
    expect(JSON.stringify(res.body)).not.toMatch(/token/);
    expect((await viewOrder(order.id, jar(session.cookie))).status).toBe(404);
    expect((await exchange(spareToken)).status).toBe(404);
    // RF-08: the browser that placed the order is cut off too (it may be the lost device),
    // and it can no longer mint links for itself.
    expect((await viewOrder(order.id, { [GUEST_COOKIE]: customer.token })).status).toBe(404);
    expect((await postOwnerLink(req("POST", `/api/v1/orders/${order.id}/access-link`, { cookies: { [GUEST_COOKIE]: customer.token } }), params({ orderId: order.id }))).status).toBe(404);

    await drainJobs();
    const op = await db().operation.findUniqueOrThrow({ where: { id: String(res.body.id) } });
    expect(op).toMatchObject({ state: "SUCCEEDED", caseReference: "CASE-104" });
    const fresh = sms.sent.at(-1)!;
    expect(fresh.recipientE164).toBe("+250788555111");
    const renewed = await exchange(tokenIn(fresh.text)!);
    expect(renewed.status).toBe(200);
    expect((await viewOrder(order.id, jar(renewed.cookie))).status).toBe(200);
  });

  it("T19: an SMS that fails after verified payment is retried, then flagged; the order stays paid and visible", async () => {
    class FailingSms implements SmsAdapter {
      readonly provider = "FAKE" as const;
      calls = 0;
      async sendTransactional(): Promise<SmsSendResult> {
        this.calls++;
        return { kind: "FAILED", code: "UNREACHABLE" };
      }
    }
    const failing = new FailingSms();
    setAdaptersForTests({ sms: failing });
    const ops = await staff("OPERATIONS");
    const { order, customer } = await paidOrder();
    for (let i = 0; i < 6; i++) {
      advanceSeconds(700);
      await drainJobs();
    }
    expect(failing.calls).toBe(3);
    const notification = await db().notification.findFirstOrThrow({ where: { orderId: order.id, event: "ORDER_CONFIRMED" } });
    expect(notification.state).toBe("FAILED");
    expect((await db().outboxJob.findFirstOrThrow({ where: { type: "NOTIFICATION_SEND", entityId: notification.id } })).state).toBe("NEEDS_REVIEW");
    expect(await currentOrder(order.id)).toMatchObject({ state: "PAID", paymentState: "PAID" });
    expect((await viewOrder(order.id, { [GUEST_COOKIE]: customer.token })).status).toBe(200);
    expect((await getStaffOrder(ops, order.id)).exceptions).toContain("SMS_FAILED");
  });

  it("T19: an SMS with an unknown outcome is never sent twice", async () => {
    class LostSms implements SmsAdapter {
      readonly provider = "FAKE" as const;
      calls = 0;
      async sendTransactional(): Promise<SmsSendResult> {
        this.calls++;
        return { kind: "UNKNOWN", reason: "timeout" };
      }
    }
    const lost = new LostSms();
    setAdaptersForTests({ sms: lost });
    const { order } = await paidOrder();
    for (let i = 0; i < 4; i++) {
      advanceSeconds(700);
      await drainJobs();
    }
    expect(lost.calls).toBe(1);
    expect((await db().notification.findFirstOrThrow({ where: { orderId: order.id } })).state).toBe("UNKNOWN");
    expect((await currentOrder(order.id)).state).toBe("PAID");
  });
});
