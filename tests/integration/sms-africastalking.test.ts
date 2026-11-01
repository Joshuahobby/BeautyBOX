import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { resetServerEnvForTests } from "@/server/env";
import { setAdaptersForTests } from "@/adapters/registry";
import { AfricasTalkingSmsAdapter } from "@/adapters/sms/africastalking";
import { isGsm7, smsLength } from "@/adapters/sms/gsm7";
import { getStaffOrder } from "@/modules/orders/staff-views";
import { opsSummary } from "@/modules/ops/summary";
import { renderSms } from "@/modules/notifications/templates";
import { formatRwf } from "@/modules/shared/money";
import { routeForLog } from "@/server/http/api";
import type { StaffIdentity } from "@/modules/staff/identity";
import { POST as postDeliveryReport } from "@/app/api/v1/callbacks/africastalking/delivery-reports/[token]/route";
import { addToCart, advanceSeconds, drainJobs, newCustomer, pay, readyCheckout, resetDatabase, seedShop, settleAndDrain, type Shop } from "./harness";

// I11 with the Africa's Talking adapter (DR-048): the real job handler, database and private
// links, with Africa's Talking answering through a simulated API in its documented shapes.
// Then delivery reports through the real route: only the secret address is accepted, a report
// must match the message id and the number, and it changes only what staff see.

const TOKEN = "dlr-token-0123456789abcdefghijklmnopqrstuvwxyz";
const RECIPIENT = "+250788555111"; // readyCheckout's contact number
let shop: Shop;

type Answer = { status: number; body: unknown };
function simulatedAfricasTalking(answer: (call: number) => Answer, senderId?: string) {
  const calls: URLSearchParams[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body));
    calls.push(form);
    const a = answer(calls.length);
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const adapter = new AfricasTalkingSmsAdapter({ username: "sandbox", apiKey: "atsk_simulated_0123456789", fetchImpl, senderId });
  return { adapter, calls };
}
const recipientAnswer = (statusCode: number, messageId: string): Answer => ({
  status: 201,
  body: { SMSMessageData: { Message: "Sent to 1/1 Total Cost: RWF 15.0000", Recipients: [{ statusCode, number: RECIPIENT, status: "Success", cost: "RWF 15.0000", messageId }] } },
});

const savedEnv = { ...process.env };
beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
});
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  resetServerEnvForTests();
});

async function paidOrder() {
  const customer = await newCustomer();
  await addToCart(customer, shop.cleanser.id, 1);
  const ready = await readyCheckout(customer);
  const { attemptId } = await pay(customer, ready);
  await drainJobs();
  await settleAndDrain(6);
  const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  return db().order.findUniqueOrThrow({ where: { id: attempt.orderId } });
}

async function staff(): Promise<StaffIdentity> {
  const authUserId = randomUUID();
  const m = await db().staffMember.create({ data: { authUserId, email: `ops-${authUserId.slice(0, 6)}@example.test`, displayName: "Test OPERATIONS", role: "OPERATIONS" } });
  return { staffId: m.id, authUserId, role: m.role, displayName: m.displayName, email: m.email, roleVersion: m.roleVersion };
}

describe("sending through the Africa's Talking adapter", () => {
  it("sends the order confirmation once, in GSM-7, to the order's contact number, and keeps the message id", async () => {
    const at = simulatedAfricasTalking(() => recipientAnswer(101, "ATXid_confirm_0001"));
    setAdaptersForTests({ sms: at.adapter });
    const order = await paidOrder();
    expect(at.calls).toHaveLength(1);
    const form = at.calls[0]!;
    expect(form.get("to")).toBe(RECIPIENT);
    expect(form.get("username")).toBe("sandbox");
    const message = form.get("message")!;
    const origin = process.env.APP_ORIGIN!.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    // One part (DR-049): the short link comes last. The simulated account has no sender ID, so
    // the "BeautyBOX: " prefix stays.
    expect(message).toMatch(new RegExp(`^BeautyBOX: Order ${order.reference} is paid: RWF [0-9,]+\\. See your order: ${origin}/o#[A-Za-z0-9_-]{43}$`));
    expect(isGsm7(message)).toBe(true);
    expect(smsLength(message).parts).toBe(1);
    const notification = await db().notification.findFirstOrThrow({ where: { orderId: order.id, event: "ORDER_CONFIRMED" } });
    expect(notification).toMatchObject({ state: "ACCEPTED", providerMessageId: "ATXid_confirm_0001", lastErrorCode: null });
  });

  it("sends from the approved sender ID and keeps the BeautyBOX prefix while it costs nothing", async () => {
    const at = simulatedAfricasTalking(() => recipientAnswer(101, "ATXid_sender_0001"), "BeautyBOX");
    setAdaptersForTests({ sms: at.adapter });
    const order = await paidOrder();
    const form = at.calls[0]!;
    expect(form.get("from")).toBe("BeautyBOX");
    // Without a support contact nothing is gained by dropping the prefix, so it stays.
    expect(form.get("message")).toMatch(new RegExp(`^BeautyBOX: Order ${order.reference} is paid: `));
  });

  it("passes the approved sender to the wording: with the BeautyBOX sender the help contact takes the prefix's place", async () => {
    const EMAIL = "help@beautyboxmarket.com";
    const s = await db().settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
    const { id: _id, version, createdAt: _c, supportContact: _sc, ...rest } = s;
    await db().settingsVersion.create({ data: { ...rest, version: version + 1, supportContact: { email: EMAIL }, reason: "support e-mail for the SMS test" } });
    const sent: Record<string, string> = {};
    for (const senderId of [undefined, "BeautyBOX"]) {
      const at = simulatedAfricasTalking(() => recipientAnswer(101, `ATXid_${senderId ?? "generic"}_0001`), senderId);
      setAdaptersForTests({ sms: at.adapter });
      const order = await paidOrder();
      const message = at.calls[0]!.get("message")!;
      const link = /https?:\/\/\S+$/.exec(message)![0];
      const expected = (brandInSender: boolean) =>
        renderSms("ORDER_CONFIRMED", { reference: order.reference, amount: formatRwf(Number(order.totalRwf)), link, contact: EMAIL, brandInSender })!;
      // This contact makes the two senders read differently, so the test tells them apart.
      expect(expected(true)).not.toBe(expected(false));
      expect(message).toBe(expected(senderId !== undefined));
      expect(smsLength(message).parts).toBe(1);
      sent[senderId ?? "generic"] = message;
    }
    expect(sent.generic!.startsWith("BeautyBOX: ")).toBe(true);
    expect(sent.generic).not.toContain("Help:");
    expect(sent.BeautyBOX!.startsWith("BeautyBOX: ")).toBe(false);
    expect(sent.BeautyBOX).toContain(`Help: ${EMAIL}.`);
  });

  it("retries a refusal (insufficient balance) three times, then flags it; the order stays paid", async () => {
    const at = simulatedAfricasTalking(() => recipientAnswer(405, "None"));
    setAdaptersForTests({ sms: at.adapter });
    const order = await paidOrder();
    for (let i = 0; i < 6; i++) {
      advanceSeconds(700);
      await drainJobs();
    }
    expect(at.calls).toHaveLength(3);
    const notification = await db().notification.findFirstOrThrow({ where: { orderId: order.id, event: "ORDER_CONFIRMED" } });
    expect(notification).toMatchObject({ state: "FAILED", lastErrorCode: "INSUFFICIENT_BALANCE", providerMessageId: null });
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).state).toBe("PAID");
    expect((await getStaffOrder(await staff(), order.id)).exceptions).toContain("SMS_FAILED");
  });

  it("never sends again after an answer that may mean it went out (HTTP 500 or GatewayError)", async () => {
    for (const answer of [{ status: 500, body: { error: "upstream" } }, recipientAnswer(501, "ATXid_gateway_0001")]) {
      await resetDatabase();
      shop = await seedShop();
      const at = simulatedAfricasTalking(() => answer);
      setAdaptersForTests({ sms: at.adapter });
      const order = await paidOrder();
      for (let i = 0; i < 4; i++) {
        advanceSeconds(700);
        await drainJobs();
      }
      expect(at.calls).toHaveLength(1);
      const notification = await db().notification.findFirstOrThrow({ where: { orderId: order.id, event: "ORDER_CONFIRMED" } });
      expect(notification.state).toBe("UNKNOWN");
      // The message id is kept when Africa's Talking gave one, so a delivery report can still match.
      expect(notification.providerMessageId).toBe(answer.status === 201 ? "ATXid_gateway_0001" : null);
    }
  });
});

describe("delivery reports", () => {
  function enableReports(token: string | null = TOKEN) {
    Object.assign(process.env, { SMS_PROVIDER: "africastalking", AFRICASTALKING_USERNAME: "sandbox", AFRICASTALKING_API_KEY: "atsk_simulated_0123456789" });
    if (token) process.env.AFRICASTALKING_CALLBACK_TOKEN = token;
    else delete process.env.AFRICASTALKING_CALLBACK_TOKEN;
    resetServerEnvForTests();
  }

  async function report(fields: Record<string, string>, opts: { token?: string; contentType?: string; raw?: string } = {}) {
    const token = opts.token ?? TOKEN;
    const body = opts.raw ?? new URLSearchParams(fields).toString();
    const request = new NextRequest(`http://localhost:3100/api/v1/callbacks/africastalking/delivery-reports/${token}`, {
      method: "POST",
      headers: { "content-type": opts.contentType ?? "application/x-www-form-urlencoded" },
      body,
    });
    return postDeliveryReport(request, { params: Promise.resolve({ token }) });
  }

  async function acceptedMessage(messageId = "ATXid_dlr_0001") {
    const at = simulatedAfricasTalking(() => recipientAnswer(101, messageId));
    setAdaptersForTests({ sms: at.adapter });
    const order = await paidOrder();
    const notification = await db().notification.findFirstOrThrow({ where: { orderId: order.id, event: "ORDER_CONFIRMED" } });
    return { order, notification, at };
  }

  const dlr = (id: string, status: string, extra: Record<string, string> = {}) => ({ id, status, phoneNumber: RECIPIENT, networkCode: "63510", ...extra });
  const deliveryOf = async (id: string) => db().notification.findUniqueOrThrow({ where: { id } });

  it("are refused (404) at any other address, or when no token is configured, and nothing is recorded", async () => {
    const { notification } = await acceptedMessage();
    enableReports();
    expect((await report(dlr("ATXid_dlr_0001", "Success"), { token: "wrong-token-0123456789abcdefghijklmnopqrstuv" })).status).toBe(404);
    enableReports(null);
    expect((await report(dlr("ATXid_dlr_0001", "Success"))).status).toBe(404);
    process.env.SMS_PROVIDER = "fake";
    process.env.AFRICASTALKING_CALLBACK_TOKEN = TOKEN;
    resetServerEnvForTests();
    expect((await report(dlr("ATXid_dlr_0001", "Success"))).status).toBe(404);
    expect((await deliveryOf(notification.id)).deliveryStatus).toBeNull();
  });

  it("record handset delivery for staff, and only that", async () => {
    const { order, notification, at } = await acceptedMessage();
    enableReports();
    const jobsBefore = await db().outboxJob.count();
    const res = await report(dlr("ATXid_dlr_0001", "Success"));
    expect(res.status).toBe(200);
    expect(await deliveryOf(notification.id)).toMatchObject({ state: "ACCEPTED", deliveryStatus: "Success", deliveryFailureReason: null });
    expect((await deliveryOf(notification.id)).deliveryReportedAt).not.toBeNull();
    const view = await getStaffOrder(await staff(), order.id);
    expect(view.notifications.find((n) => n.event === "ORDER_CONFIRMED")).toMatchObject({ deliveryStatus: "Success", deliveryFailureReason: null });
    expect(view.exceptions).not.toContain("SMS_NOT_DELIVERED_TO_PHONE");
    // Nothing else moved: no new job, no new send, order and payment as they were.
    expect(await db().outboxJob.count()).toBe(jobsBefore);
    expect(at.calls).toHaveLength(1);
    expect(await db().order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ state: order.state, paymentState: order.paymentState, version: order.version });
  });

  it("show a failed delivery to staff and in the ops alerts, without sending again", async () => {
    const { order, notification, at } = await acceptedMessage();
    enableReports();
    expect((await report(dlr("ATXid_dlr_0001", "Failed", { failureReason: "UserDoesNotExist" }))).status).toBe(200);
    expect(await deliveryOf(notification.id)).toMatchObject({ deliveryStatus: "Failed", deliveryFailureReason: "UserDoesNotExist" });
    expect((await getStaffOrder(await staff(), order.id)).exceptions).toContain("SMS_NOT_DELIVERED_TO_PHONE");
    const summary = await opsSummary();
    expect(summary.notifications.notDeliveredToPhone).toBe(1);
    expect(summary.alerts).toContain("SMS_NOT_DELIVERED");
    advanceSeconds(3600);
    await drainJobs();
    expect(at.calls).toHaveLength(1);
  });

  it("keep the most informative report when they arrive out of order", async () => {
    const { notification } = await acceptedMessage();
    enableReports();
    await report(dlr("ATXid_dlr_0001", "Buffered"));
    await report(dlr("ATXid_dlr_0001", "AbsentSubscriber"));
    expect((await deliveryOf(notification.id)).deliveryStatus).toBe("AbsentSubscriber");
    await report(dlr("ATXid_dlr_0001", "Success"));
    await report(dlr("ATXid_dlr_0001", "Submitted"));
    await report(dlr("ATXid_dlr_0001", "Failed", { failureReason: "DeliveryFailure" }));
    expect(await deliveryOf(notification.id)).toMatchObject({ deliveryStatus: "Success", deliveryFailureReason: null });
  });

  it("match a message whose send outcome was unknown, without changing that outcome", async () => {
    const at = simulatedAfricasTalking(() => recipientAnswer(501, "ATXid_unknown_0001"));
    setAdaptersForTests({ sms: at.adapter });
    const order = await paidOrder();
    enableReports();
    expect((await report(dlr("ATXid_unknown_0001", "Success"))).status).toBe(200);
    const notification = await db().notification.findFirstOrThrow({ where: { orderId: order.id, event: "ORDER_CONFIRMED" } });
    expect(notification).toMatchObject({ state: "UNKNOWN", deliveryStatus: "Success" });
  });

  it("ignore (but accept) reports for an unknown message or another number", async () => {
    const { notification } = await acceptedMessage();
    enableReports();
    expect((await report(dlr("ATXid_someone_else", "Failed"))).status).toBe(200);
    expect((await report(dlr("ATXid_dlr_0001", "Failed", { phoneNumber: "+250788000999" }))).status).toBe(200);
    expect((await deliveryOf(notification.id)).deliveryStatus).toBeNull();
  });

  it("leave updated_at as it was, so a late report does not restart an alert window", async () => {
    const at = simulatedAfricasTalking(() => recipientAnswer(501, "ATXid_unknown_0002"));
    setAdaptersForTests({ sms: at.adapter });
    const order = await paidOrder();
    const before = await db().notification.findFirstOrThrow({ where: { orderId: order.id, event: "ORDER_CONFIRMED" } });
    advanceSeconds(3 * 24 * 3600);
    enableReports();
    expect((await report(dlr("ATXid_unknown_0002", "Success"))).status).toBe(200);
    const after = await deliveryOf(before.id);
    expect(after.deliveryStatus).toBe("Success");
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.deliveryReportedAt!.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("never write the address's token to the log, even when the route fails", async () => {
    expect(routeForLog(`/api/v1/callbacks/africastalking/delivery-reports/${TOKEN}`)).toBe("/api/v1/callbacks/africastalking/delivery-reports/:token");
    expect(routeForLog("/api/v1/staff/orders/7d1d8f0e-3f7a-4a51-9a5e-8a4d2c1b0f9e/commands")).toBe("/api/v1/staff/orders/:id/commands");
    expect(routeForLog("/api/v1/catalog/products/hydrating-cleanser-200ml")).toBe("/api/v1/catalog/products/hydrating-cleanser-200ml");
    enableReports();
    process.env.WORKER_SECRET = "too-short"; // configuration now fails to load: an unexpected error
    resetServerEnvForTests();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await report(dlr("ATXid_dlr_0001", "Success"))).status).toBe(500);
      const lines = logged.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("api_unhandled") && l.includes("delivery-reports/:token"))).toBe(true);
      expect(lines.join(" ")).not.toContain(TOKEN);
    } finally {
      logged.mockRestore();
    }
  });

  it("refuse what is not a delivery report", async () => {
    const { notification } = await acceptedMessage();
    enableReports();
    expect((await report(dlr("ATXid_dlr_0001", "Delivered"))).status).toBe(400);
    expect((await report({ id: "ATXid_dlr_0001", status: "Success" })).status).toBe(400);
    expect((await report({}, { contentType: "application/json", raw: JSON.stringify(dlr("ATXid_dlr_0001", "Success")) })).status).toBe(400);
    expect((await report({}, { raw: `id=ATXid_dlr_0001&status=Success&phoneNumber=${encodeURIComponent(RECIPIENT)}&pad=${"x".repeat(9000)}` })).status).toBe(413);
    expect((await deliveryOf(notification.id)).deliveryStatus).toBeNull();
  });
});
