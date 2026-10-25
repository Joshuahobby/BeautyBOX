import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { setAdaptersForTests } from "@/adapters/registry";
import type { SmsAdapter, SmsSendResult } from "@/adapters/sms/types";
import { requestRefund } from "@/modules/refunds/refunds";
import { GET as getOpsSummary } from "@/app/api/v1/internal/ops-summary/route";
import { PHONES, addToCart, advanceSeconds, drainJobs, newCustomer, pay, readyCheckout, resetDatabase, seedShop, settleAndDrain, type Shop } from "./harness";

// I13 monitoring probe: secret-protected, counts only, and raises the alerts an operator
// must act on (unresolved money, failed refunds/SMS, stuck jobs, waiting requests).

let shop: Shop;
beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
});

const probe = (secret?: string) =>
  getOpsSummary(new NextRequest(`${process.env.APP_ORIGIN}/api/v1/internal/ops-summary`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} }), { params: Promise.resolve({}) });

describe("ops summary", () => {
  it("requires the internal secret", async () => {
    expect((await probe()).status).toBe(401);
    expect((await probe("wrong-secret-wrong-secret-wrong-secret")).status).toBe(401);
    const ok = await probe(process.env.WORKER_SECRET);
    expect(ok.status).toBe(200);
    expect((await ok.json()).alerts).toEqual([]);
  });

  it("raises alerts for undelivered SMS, refunds awaiting a decision and long-unresolved payments, without personal data", async () => {
    class FailingSms implements SmsAdapter {
      readonly provider = "FAKE" as const;
      async sendTransactional(): Promise<SmsSendResult> {
        return { kind: "FAILED", code: "UNREACHABLE" };
      }
    }
    setAdaptersForTests({ sms: new FailingSms() });
    const buyer = await newCustomer();
    await addToCart(buyer, shop.cleanser.id, 1);
    const { attemptId } = await pay(buyer, await readyCheckout(buyer));
    await drainJobs();
    await settleAndDrain(6);
    for (let i = 0; i < 4; i++) {
      advanceSeconds(700);
      await drainJobs();
    }
    const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const receipt = await db().paymentReceipt.findFirstOrThrow({ where: { orderId: attempt.orderId } });
    const finance = await db().staffMember.create({ data: { authUserId: randomUUID(), email: "fin@example.test", displayName: "Finance", role: "FINANCE" } });
    await requestRefund(
      { staffId: finance.id, authUserId: finance.authUserId, role: "FINANCE", displayName: "Finance", email: finance.email, roleVersion: 1 },
      { orderId: attempt.orderId, receiptId: receipt.id, amountRwf: 1000, reason: "Goodwill" },
      `test-${randomUUID()}`,
      null,
    );

    const stuck = await newCustomer();
    await addToCart(stuck, shop.cleanser.id, 1);
    await pay(stuck, await readyCheckout(stuck), { phone: PHONES.neverSettles });
    await drainJobs();
    advanceSeconds(2 * 60 * 60 + 60);

    const res = await probe(process.env.WORKER_SECRET);
    const text = await res.text();
    const body = JSON.parse(text) as { alerts: string[]; payments: { unresolvedOverReviewAge: number }; refunds: { awaitingDecision: number }; notifications: { failed: number } };
    expect(body.alerts).toEqual(expect.arrayContaining(["SMS_NOT_DELIVERED", "JOBS_NEED_REVIEW", "REFUNDS_AWAITING_DECISION", "PAYMENTS_UNRESOLVED_LONG", "JOB_BACKLOG"]));
    expect(body.payments.unresolvedOverReviewAge).toBe(1);
    expect(body.refunds.awaitingDecision).toBe(1);
    expect(body.notifications.failed).toBe(1);
    // Counts only: no phone numbers, order references or amounts.
    expect(text).not.toMatch(/\+2507|BB-[A-Z0-9]{4}|17100|Goodwill/);
  });
});
