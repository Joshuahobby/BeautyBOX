import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setAdaptersForTests } from "@/adapters/registry";
import { FakeSmsAdapter } from "@/adapters/sms/fake";
import { FakeEmailAdapter } from "@/adapters/email/fake";
import type { EmailAdapter, EmailSendResult } from "@/adapters/email/types";
import {
  addToCart,
  advanceSeconds,
  drainJobs,
  newCustomer,
  pay,
  readyCheckout,
  resetDatabase,
  seedShop,
  settleAndDrain,
  type Shop,
} from "./harness";

// DR-057, DR-059: order e-mail is the launch channel. Real PostgreSQL and domain modules;
// the providers are deterministic fakes, so nothing is sent.

let shop: Shop;
let sms: FakeSmsAdapter;
let email: FakeEmailAdapter;

beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
  sms = new FakeSmsAdapter({ persist: false });
  email = new FakeEmailAdapter();
  setAdaptersForTests({ sms, email });
});

async function paidOrder() {
  const customer = await newCustomer();
  await addToCart(customer, shop.cleanser.id, 1);
  const ready = await readyCheckout(customer);
  const { attemptId } = await pay(customer, ready);
  await drainJobs();
  await settleAndDrain(6);
  const attempt = await db().paymentAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  const order = await db().order.findUniqueOrThrow({
    where: { id: attempt.orderId },
  });
  expect(order.state).toBe("PAID");
  return order;
}

describe("order e-mail (DR-059)", () => {
  it("copies the checkout e-mail onto the order and e-mails the confirmation with a private link", async () => {
    const order = await paidOrder();
    expect(order.recipientEmail).toBe("buyer@example.com");
    await drainJobs();

    const notifications = await db().notification.findMany({
      where: { orderId: order.id },
    });
    expect(notifications.map((n) => [n.event, n.templateId, n.state])).toEqual([
      ["ORDER_CONFIRMED", "email.order_confirmed", "ACCEPTED"],
    ]);
    expect(sms.sent).toHaveLength(0);
    expect(email.sent).toHaveLength(1);
    const sent = email.sent[0]!;
    expect(sent.to).toBe("buyer@example.com");
    expect(sent.subject).toContain(order.reference);
    expect(sent.text).toMatch(/\/order-access#token=[A-Za-z0-9_-]{43}/);
    expect(sent.html).toContain("View your order");
    // DR-061: the confirmation lists the order's own lines and total.
    expect(sent.text).toMatch(/1 x .+: RWF [\d,]+/);
    expect(sent.text).toContain(`Total paid: RWF`);
    const links = await db().privateOrderLink.findMany({
      where: { orderId: order.id, reason: "Sent with e-mail ORDER_CONFIRMED" },
    });
    expect(links).toHaveLength(1);
    // The simulated mailbox received it too.
    const rows = await db().$queryRaw<
      { recipient: string; outcome: string }[]
    >`SELECT recipient, outcome FROM devsim.email_messages`;
    expect(rows).toEqual([
      { recipient: "buyer@example.com", outcome: "ACCEPTED" },
    ]);
  });

  it("keeps using SMS when e-mail is switched off", async () => {
    setAdaptersForTests({
      sms,
      email: {
        provider: "DISABLED",
        sendTransactional: async () => ({
          kind: "FAILED",
          code: "EMAIL_DISABLED",
        }),
      },
    });
    const order = await paidOrder();
    await drainJobs();
    const notifications = await db().notification.findMany({
      where: { orderId: order.id },
    });
    expect(notifications.map((n) => n.templateId)).toEqual([
      "sms.order_confirmed",
    ]);
    expect(sms.sent).toHaveLength(1);
  });

  it("retries a definite refusal three times, then leaves it for staff; the order stays paid", async () => {
    class Refusing implements EmailAdapter {
      readonly provider = "FAKE" as const;
      keys: string[] = [];
      async sendTransactional(m: {
        idempotencyKey: string;
      }): Promise<EmailSendResult> {
        this.keys.push(m.idempotencyKey);
        return { kind: "FAILED", code: "REQUEST_REJECTED" };
      }
    }
    const refusing = new Refusing();
    setAdaptersForTests({ sms, email: refusing });
    const order = await paidOrder();
    for (let i = 0; i < 6; i++) {
      advanceSeconds(700);
      await drainJobs();
    }
    expect(refusing.keys).toHaveLength(3);
    expect(new Set(refusing.keys).size).toBe(3); // a fresh key per attempt (each carries a new link)
    const notification = await db().notification.findFirstOrThrow({
      where: { orderId: order.id, event: "ORDER_CONFIRMED" },
    });
    expect(notification.state).toBe("FAILED");
    expect(
      (
        await db().outboxJob.findFirstOrThrow({
          where: { type: "NOTIFICATION_SEND", entityId: notification.id },
        })
      ).state,
    ).toBe("NEEDS_REVIEW");
    expect(
      (await db().order.findUniqueOrThrow({ where: { id: order.id } })).state,
    ).toBe("PAID");
    expect(sms.sent).toHaveLength(0);
  });

  it("never sends an e-mail twice after an unknown outcome", async () => {
    class Lost implements EmailAdapter {
      readonly provider = "FAKE" as const;
      calls = 0;
      async sendTransactional(): Promise<EmailSendResult> {
        this.calls++;
        return { kind: "UNKNOWN", reason: "timeout" };
      }
    }
    const lost = new Lost();
    setAdaptersForTests({ sms, email: lost });
    const order = await paidOrder();
    for (let i = 0; i < 4; i++) {
      advanceSeconds(700);
      await drainJobs();
    }
    expect(lost.calls).toBe(1);
    expect(
      (
        await db().notification.findFirstOrThrow({
          where: { orderId: order.id },
        })
      ).state,
    ).toBe("UNKNOWN");
  });

  it("refuses a checkout without a valid e-mail address", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const { updateCheckout, createOrReuseCheckout } =
      await import("@/modules/checkout/checkout");
    const cart = await db().cart.findFirstOrThrow({
      where: { guestSessionId: customer.id },
    });
    const checkout = await createOrReuseCheckout(
      customer,
      { cartId: cart.id, expectedCartVersion: cart.version },
      `k-${Date.now()}`,
    );
    await expect(
      updateCheckout(
        customer,
        checkout.id,
        {
          expectedRevision: checkout.revision,
          recipient: {
            name: "No Mail",
            phone: "+250788555111",
            email: "not-an-address",
          },
          destination: { lat: -1.95, lng: 30.06 },
          destinationConfirmed: "CUSTOMER_CONFIRMED",
        },
        `k2-${Date.now()}`,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
