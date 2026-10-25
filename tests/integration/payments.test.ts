import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { paymentAdapter, setAdaptersForTests } from "@/adapters/registry";
import { FakePaymentAdapter } from "@/adapters/payments/fake";
import type { PaymentAdapter } from "@/adapters/payments/types";
import { claimDueJobs } from "@/modules/jobs/outbox";
import { handleReservationExpiry } from "@/modules/payments/handlers";
import { applyVerifiedFailure, applyVerifiedSuccess } from "@/modules/payments/outcomes";
import { getCheckoutView } from "@/modules/checkout/checkout";
import { getCustomerOrderView } from "@/modules/orders/customer-views";
import { ingestProviderCallback } from "@/modules/payments/handlers";
import {
  PHONES,
  addToCart,
  advanceSeconds,
  drainJobs,
  expectDomainError,
  key,
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

let shop: Shop;

beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop({ reservationTtlSeconds: 900 });
});

async function attemptsFor(orderId: string) {
  return db().paymentAttempt.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
}

describe("happy path: product -> cart -> quote -> pending -> verified paid -> committed stock", () => {
  it("commits reserved stock exactly once after verified success and confirms the private order", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 2);
    await addToCart(customer, shop.lipBrownie.id, 1);
    const ready = await readyCheckout(customer);
    expect(ready.quote.amountRwf).toBe(2100); // 5.0 km on the proposed test tariff
    expect(ready.total).toBe(15000 * 2 + 12000 + 2100);

    const { attemptId } = await pay(customer, ready);
    let attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.state).toBe("CREATED");
    expect(Number(attempt.amountRwf)).toBe(44100);
    expect(await lotTotals(shop.cleanser.id)).toEqual({ onHand: 10, reserved: 2, committed: 0 });

    // Initiation acceptance is not payment.
    await drainJobs();
    attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.state).toBe("PENDING");
    let order = await db().order.findUniqueOrThrow({ where: { id: attempt.orderId } });
    expect(order.state).toBe("AWAITING_PAYMENT");
    expect(order.paymentState).toBe("PENDING");

    await settleAndDrain();
    attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    order = await db().order.findUniqueOrThrow({ where: { id: attempt.orderId } });
    expect(attempt.state).toBe("SUCCEEDED");
    expect(order.state).toBe("PAID");
    expect(order.paymentState).toBe("PAID");
    expect(await lotTotals(shop.cleanser.id)).toEqual({ onHand: 10, reserved: 0, committed: 2 });
    expect(await db().paymentReceipt.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db().allocation.count()).toBe(2 + 0); // cleanser (one lot by FEFO) + lip
    const view = await getCustomerOrderView(order.id, { guestSession: customer, orderSessionTokens: [] });
    expect(view.state).toBe("PAID");
    expect(view.totalRwf).toBe(44100);
    expect(await ledgerMismatches()).toBe(0);
  });

  it("allocates earliest-expiry lots first and records supplier obligations from the lots used", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 5);
    const ready = await readyCheckout(customer);
    await pay(customer, ready);
    await drainJobs();
    await settleAndDrain();
    const allocations = await db().allocation.findMany({ include: { lot: true, obligation: true } });
    const consigned = allocations.find((a) => a.lot.batchReference === "C-CONSIGNED")!;
    const owned = allocations.find((a) => a.lot.batchReference === "C-OWNED")!;
    expect(consigned.quantity).toBe(4); // expires 2027-06, used first
    expect(owned.quantity).toBe(1);
    expect(consigned.obligation?.basis).toBe("AGREEMENT_COST");
    expect(Number(consigned.obligation?.amountRwf)).toBe(36000);
    expect(owned.obligation).toBeNull(); // BeautyBOX-owned stock creates no supplier obligation
  });
});

describe("T01 last-unit concurrency", () => {
  it("lets exactly one of two concurrent buyers reserve the final unit", async () => {
    const a = await newCustomer();
    const b = await newCustomer();
    await addToCart(a, shop.last.id, 1);
    await addToCart(b, shop.last.id, 1);
    const [readyA, readyB] = await Promise.all([readyCheckout(a), readyCheckout(b)]);
    const results = await Promise.allSettled([pay(a, readyA), pay(b, readyB)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0]!.reason as { code: string }).code).toBe("STOCK_CHANGED");
    expect(await lotTotals(shop.last.id)).toEqual({ onHand: 1, reserved: 1, committed: 0 });
    expect(await db().reservation.count({ where: { state: "ACTIVE" } })).toBe(1);
  });

  it("never oversells under many concurrent buyers", async () => {
    const buyers = await Promise.all(Array.from({ length: 6 }, () => newCustomer()));
    for (const b of buyers) await addToCart(b, shop.lipBrownie.id, 1); // only 3 in stock
    const readies = await Promise.all(buyers.map((b) => readyCheckout(b)));
    const results = await Promise.allSettled(buyers.map((b, i) => pay(b, readies[i]!)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const totals = await lotTotals(shop.lipBrownie.id);
    expect(totals.reserved).toBe(3);
    expect(totals.onHand - totals.reserved - totals.committed).toBe(0);
    expect(await ledgerMismatches()).toBe(0);
  });
});

describe("T02/T03 idempotent payment intent", () => {
  it("returns one attempt for the same key sent twice concurrently and rejects a changed payload", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const ready = await readyCheckout(customer);
    const k = key();
    const [r1, r2] = await Promise.all([pay(customer, ready, { idempotencyKey: k }), pay(customer, ready, { idempotencyKey: k })]);
    expect(r1.attemptId).toBe(r2.attemptId);
    expect([r1.replayed, r2.replayed].sort()).toEqual([false, true]);
    expect(await db().paymentAttempt.count()).toBe(1);
    await expectDomainError(pay(customer, ready, { idempotencyKey: k, method: "AIRTEL_RWA" }), "IDEMPOTENCY_CONFLICT");
  });

  it("allows only one unresolved attempt even with different keys", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const ready = await readyCheckout(customer);
    const results = await Promise.allSettled([pay(customer, ready), pay(customer, ready)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["PAYMENT_UNRESOLVED", "QUOTE_INVALID"]).toContain((rejected.reason as { code: string }).code);
    expect(await db().paymentAttempt.count()).toBe(1);
    // The checkout exposes the existing attempt for recovery (contract addition CC-01).
    const checkout = await getCheckoutView(customer, ready.checkout.id);
    expect(checkout.state).toBe("PAYMENT_PENDING");
    expect(checkout.activeAttemptId).not.toBeNull();
  });

  it("is protected by the database even if application checks were bypassed", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const ready = await readyCheckout(customer);
    const { attemptId } = await pay(customer, ready);
    const first = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    await expect(
      db().paymentAttempt.create({
        data: {
          orderId: first.orderId,
          provider: "FAKE",
          providerDepositId: crypto.randomUUID(),
          orderSnapshotRevision: first.orderSnapshotRevision,
          amountRwf: first.amountRwf,
          method: first.method,
          payerPhoneEncrypted: first.payerPhoneEncrypted,
          payerPhoneMasked: first.payerPhoneMasked,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("T04/T17 lost responses and interrupted workers", () => {
  it("recovers the existing deposit after a lost initiation response without a second collection", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const ready = await readyCheckout(customer);
    const { attemptId } = await pay(customer, ready, { phone: PHONES.lostResponse });
    await drainJobs(1); // initiation: provider records the deposit, response is lost
    let attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.state).toBe("CREATED");
    expect(attempt.verificationFlag).toBe("UNKNOWN");

    await settleAndDrain(10);
    attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.state).toBe("SUCCEEDED");
    const deposits = await db().$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM devsim.deposits`;
    expect(Number(deposits[0]!.n)).toBe(1);
    expect(await db().paymentAttempt.count()).toBe(1);
  });

  it("reclaims an expired lease and looks the deposit up instead of resending", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const ready = await readyCheckout(customer);
    const { attemptId } = await pay(customer, ready);
    const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });

    // A worker claims the initiation job, sends the request, then dies before saving.
    const [job] = await claimDueJobs({ batchSize: 1, leaseSeconds: 60, owner: "doomed-worker" });
    expect(job?.type).toBe("PAYMENT_INITIATE");
    const sent = await paymentAdapter().initiateDeposit({
      depositId: attempt.providerDepositId, amountRwf: Number(attempt.amountRwf), method: attempt.method,
      payerMsisdn: "250788123000", customerMessage: "BeautyBOX order", clientReference: "T17",
    });
    expect(sent.kind).toBe("ACCEPTED");

    let initiateCalls = 0;
    const real = new FakePaymentAdapter();
    const counting: PaymentAdapter = Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
      initiateDeposit: async (...args: Parameters<PaymentAdapter["initiateDeposit"]>) => {
        initiateCalls++;
        return real.initiateDeposit(...args);
      },
    });
    setAdaptersForTests({ payments: counting });

    advanceSeconds(61); // lease expires; the same intent is retried
    await drainJobs();
    expect(initiateCalls).toBe(0); // found by lookup, never resent
    const after = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(["PENDING", "SUCCEEDED"]).toContain(after.state);
    const deposits = await db().$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM devsim.deposits`;
    expect(Number(deposits[0]!.n)).toBe(1);
  });
});

describe("T05/T06 duplicate, stale and forged provider events", () => {
  it("applies a repeated verified success once and never downgrades it", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const ready = await readyCheckout(customer);
    const { attemptId } = await pay(customer, ready);
    await drainJobs();
    await settleAndDrain();
    const outcome = { amountRwf: 17100, currency: "RWF", providerTransactionId: "dup", providerStatus: "COMPLETED", evidenceRef: "dup" };
    expect(await applyVerifiedSuccess(attemptId, outcome)).toBe("DUPLICATE");
    expect(await applyVerifiedSuccess(attemptId, outcome)).toBe("DUPLICATE");
    expect(await applyVerifiedFailure(attemptId, { failureCode: "OLD", providerStatus: "FAILED" })).toBe("IGNORED_AFTER_SUCCESS");
    const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.state).toBe("SUCCEEDED");
    expect(await db().paymentReceipt.count()).toBe(1);
    expect(await db().inventoryMovement.count({ where: { type: "COMMIT" } })).toBe(1);
    expect(await db().notification.count()).toBe(1);
    // The database itself refuses a downgrade.
    await expect(db().paymentAttempt.update({ where: { id: attemptId }, data: { state: "FAILED" } })).rejects.toThrow();
  });

  it("rejects a forged callback and treats a valid callback only as a trigger for a status lookup", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const ready = await readyCheckout(customer);
    const { attemptId } = await pay(customer, ready, { phone: PHONES.neverSettles });
    await drainJobs();
    const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });

    const body = Buffer.from(JSON.stringify({ depositId: attempt.providerDepositId, status: "COMPLETED" }));
    await expectDomainError(
      ingestProviderCallback({ rawBody: body, headers: new Headers({ "x-devsim-signature": "forged" }), method: "POST", url: "http://localhost/api/v1/callbacks/pawapay" }),
      "UNAUTHORIZED",
    );
    // Correctly signed, but the provider still reports processing: nothing is marked paid.
    const signed = new Headers({ "x-devsim-signature": FakePaymentAdapter.simulatedSignature(body) });
    await ingestProviderCallback({ rawBody: body, headers: signed, method: "POST", url: "http://localhost/api/v1/callbacks/pawapay" });
    await ingestProviderCallback({ rawBody: body, headers: signed, method: "POST", url: "http://localhost/api/v1/callbacks/pawapay" });
    await settleAndDrain();
    const after = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(after.state).toBe("PENDING");
    expect(await db().paymentReceipt.count()).toBe(0);
    expect(await db().providerEvent.count({ where: { signatureStatus: "INVALID" } })).toBe(1);
    expect(await db().providerEvent.count({ where: { signatureStatus: "SIMULATED" } })).toBe(1); // replay deduplicated
  });

  it("puts an amount mismatch in finance review and never marks the order paid", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const ready = await readyCheckout(customer);
    const { attemptId } = await pay(customer, ready, { phone: PHONES.mismatch });
    await drainJobs();
    await settleAndDrain();
    const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { order: true } });
    expect(attempt.verificationFlag).toBe("MISMATCH");
    expect(attempt.order.paymentState).toBe("EXCEPTION");
    expect(attempt.order.state).toBe("ON_HOLD");
    expect(await lotTotals(shop.cleanser.id)).toEqual({ onHand: 10, reserved: 0, committed: 0 });
    expect(await db().refundCase.count({ where: { source: "PAYMENT_REVIEW" } })).toBe(1);
  });
});

describe("verified failure and retry", () => {
  it("releases stock on verified failure and allows a new attempt only after a fresh quote", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const ready = await readyCheckout(customer);
    const { attemptId } = await pay(customer, ready, { phone: PHONES.fail });
    await drainJobs();
    await settleAndDrain();
    const failed = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(failed.state).toBe("FAILED");
    expect(await lotTotals(shop.cleanser.id)).toEqual({ onHand: 10, reserved: 0, committed: 0 });
    // The used quote cannot be paid again: the customer reviews a fresh total.
    await expectDomainError(pay(customer, ready), "QUOTE_INVALID");
    const retry = await readyCheckout(customer);
    const second = await pay(customer, retry);
    expect(second.attemptId).not.toBe(attemptId);
    const attempts = await attemptsFor(failed.orderId);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.orderSnapshotRevision).toBe(2);
  });

  it("treats a rejection at initiation as a verified failure", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const { attemptId } = await pay(customer, await readyCheckout(customer), { phone: PHONES.reject });
    await drainJobs();
    expect((await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).state).toBe("FAILED");
  });
});

describe("T07/T08 reservation expiry and late success", () => {
  it("keeps a timed-out payment unresolved, releases stock, and never produces FAILED from a timer", async () => {
    await resetDatabase();
    shop = await seedShop({ reservationTtlSeconds: 60 });
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const { attemptId } = await pay(customer, await readyCheckout(customer), { phone: PHONES.neverSettles });
    await drainJobs();
    advanceSeconds(61);
    await drainJobs();
    const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { reservation: true } });
    expect(attempt.state).toBe("PENDING");
    expect(attempt.verificationFlag).toBe("UNKNOWN");
    expect(attempt.reservation?.state).toBe("EXPIRED");
    expect(await lotTotals(shop.cleanser.id)).toEqual({ onHand: 10, reserved: 0, committed: 0 });
  });

  it("never releases committed stock when expiry races a success", async () => {
    await resetDatabase();
    shop = await seedShop({ reservationTtlSeconds: 60 });
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 2);
    const { attemptId } = await pay(customer, await readyCheckout(customer));
    await drainJobs();
    advanceSeconds(61); // settled at the provider AND reservation due to expire
    const reservation = await db().reservation.findFirstOrThrow({ where: { paymentAttemptId: attemptId } });
    const expiryJob = { id: "n/a", type: "RESERVATION_EXPIRY" as const, entityId: reservation.id, payload: {}, attempts: 1, uniqueIntentKey: "x", leaseOwner: "t" };
    await Promise.all([
      handleReservationExpiry(expiryJob),
      applyVerifiedSuccess(attemptId, { amountRwf: 32100, currency: "RWF", providerTransactionId: "race", providerStatus: "COMPLETED", evidenceRef: "race" }),
    ]);
    await drainJobs();
    expect(await lotTotals(shop.cleanser.id)).toEqual({ onHand: 10, reserved: 0, committed: 2 });
    expect((await db().order.findFirstOrThrow()).state).toBe("PAID");
    expect(await ledgerMismatches()).toBe(0);
  });

  it("reallocates a late success when stock is still free", async () => {
    await resetDatabase();
    shop = await seedShop({ reservationTtlSeconds: 60 });
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const { attemptId } = await pay(customer, await readyCheckout(customer), { phone: PHONES.neverSettles });
    await drainJobs();
    advanceSeconds(61);
    await drainJobs(); // reservation expires, payment unresolved
    expect(await applyVerifiedSuccess(attemptId, { amountRwf: 17100, currency: "RWF", providerTransactionId: "late", providerStatus: "COMPLETED", evidenceRef: "late" })).toBe("APPLIED");
    expect(await lotTotals(shop.cleanser.id)).toEqual({ onHand: 10, reserved: 0, committed: 1 });
  });

  it("holds a paid order (no oversell, no substitution) when the released stock was sold", async () => {
    await resetDatabase();
    shop = await seedShop({ reservationTtlSeconds: 60 });
    const slow = await newCustomer();
    await addToCart(slow, shop.last.id, 1);
    const { attemptId } = await pay(slow, await readyCheckout(slow), { phone: PHONES.neverSettles });
    await drainJobs();
    advanceSeconds(61);
    await drainJobs(); // last unit released
    const fast = await newCustomer();
    await addToCart(fast, shop.last.id, 1);
    await pay(fast, await readyCheckout(fast));
    await drainJobs();
    await settleAndDrain(); // fast buyer pays and commits the unit

    const result = await applyVerifiedSuccess(attemptId, { amountRwf: 22100, currency: "RWF", providerTransactionId: "late", providerStatus: "COMPLETED", evidenceRef: "late" });
    expect(result).toBe("ON_HOLD");
    const order = await db().order.findFirstOrThrow({ where: { attempts: { some: { id: attemptId } } } });
    expect(order.state).toBe("ON_HOLD");
    expect(order.holdReason).toBe("STOCK_UNAVAILABLE");
    expect(order.paymentState).toBe("PAID");
    expect(await db().refundCase.count({ where: { orderId: order.id, source: "STOCK_HOLD" } })).toBe(1);
    expect(await lotTotals(shop.last.id)).toEqual({ onHand: 1, reserved: 0, committed: 1 });
  });
});

describe("T10 additional collection after a verified failure was superseded", () => {
  it("records an overpayment for refund and fulfils the order once", async () => {
    const customer = await newCustomer();
    await addToCart(customer, shop.cleanser.id, 1);
    const first = await pay(customer, await readyCheckout(customer), { phone: PHONES.fail });
    await drainJobs();
    await settleAndDrain();
    const second = await pay(customer, await readyCheckout(customer));
    await drainJobs();
    await settleAndDrain();
    // Provider later (conflictingly) reports the first, failed intent as collected.
    const result = await applyVerifiedSuccess(first.attemptId, { amountRwf: 17100, currency: "RWF", providerTransactionId: "extra", providerStatus: "COMPLETED", evidenceRef: "extra" });
    expect(result).toBe("OVERPAYMENT");
    const order = await db().order.findFirstOrThrow({ where: { attempts: { some: { id: second.attemptId } } } });
    expect(order.state).toBe("PAID");
    expect(await db().paymentReceipt.count({ where: { orderId: order.id } })).toBe(2);
    expect(await db().refundCase.count({ where: { orderId: order.id, source: "OVERPAYMENT" } })).toBe(1);
    expect(await lotTotals(shop.cleanser.id)).toEqual({ onHand: 10, reserved: 0, committed: 1 });
  });
});
