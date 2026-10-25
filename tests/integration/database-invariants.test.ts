import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { addToCart, drainJobs, newCustomer, ownerQuery, pay, readyCheckout, resetDatabase, seedShop, settleAndDrain, type Shop } from "./harness";

// Invariants enforced by PostgreSQL itself (constraints, partial indexes, triggers,
// grants), so they hold even if application code is wrong or bypassed.

let shop: Shop;

beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
});

describe("stock lots", () => {
  it("T18: rejects an adjustment that would consume reserved or committed units", async () => {
    const c = await newCustomer();
    await addToCart(c, shop.last.id, 1);
    await pay(c, await readyCheckout(c)); // reserves the only unit
    const lot = await db().inventoryLot.findFirstOrThrow({ where: { variantId: shop.last.id } });
    await expect(db().inventoryLot.update({ where: { id: lot.id }, data: { quantityOnHand: 0 } })).rejects.toThrow();
    await expect(db().inventoryLot.update({ where: { id: lot.id }, data: { reservedQty: -1 } })).rejects.toThrow();
  });

  it("keeps the ledger append-only, even for the schema owner", async () => {
    const movement = await db().inventoryMovement.findFirstOrThrow();
    await expect(db().inventoryMovement.update({ where: { id: movement.id }, data: { reason: "rewrite history" } })).rejects.toThrow();
    await expect(ownerQuery(`DELETE FROM commerce.inventory_movements WHERE id = $1`, [movement.id])).rejects.toThrow(/append-only/);
  });

  it("does not let the runtime role delete financial history", async () => {
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    await pay(c, await readyCheckout(c));
    await expect(db().$executeRaw`DELETE FROM commerce.payment_attempts`).rejects.toThrow(/permission denied/);
    await expect(db().$executeRaw`DELETE FROM commerce.orders`).rejects.toThrow(/permission denied/);
  });
});

describe("receipts and refunds", () => {
  async function paidOrder() {
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    await pay(c, await readyCheckout(c));
    await drainJobs();
    await settleAndDrain();
    const receipt = await db().paymentReceipt.findFirstOrThrow();
    const refundCase = await db().refundCase.create({ data: { orderId: receipt.orderId, receiptId: receipt.id, source: "STAFF_REQUEST", reason: "test" } });
    return { receipt, refundCase };
  }

  it("makes verified receipts immutable", async () => {
    const { receipt } = await paidOrder();
    await expect(db().paymentReceipt.update({ where: { id: receipt.id }, data: { verifiedAmountRwf: 1n } })).rejects.toThrow();
  });

  it("T11 (database layer): concurrent approvals cannot reserve more than was collected", async () => {
    const { receipt, refundCase } = await paidOrder(); // 17,100 collected
    const approve = (amount: number) =>
      db().refund.create({
        data: { caseId: refundCase.id, receiptId: receipt.id, amountRwf: BigInt(amount), state: "APPROVED", reason: "partial" },
      });
    const results = await Promise.allSettled([approve(10000), approve(10000)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db().refund.count()).toBe(1);
  });

  it("allows at most one external refund in flight per deposit", async () => {
    const { receipt, refundCase } = await paidOrder();
    await db().refund.create({ data: { caseId: refundCase.id, receiptId: receipt.id, amountRwf: 1000n, state: "SUBMITTED", reason: "a" } });
    await expect(
      db().refund.create({ data: { caseId: refundCase.id, receiptId: receipt.id, amountRwf: 1000n, state: "PENDING", reason: "b" } }),
    ).rejects.toThrow();
  });
});

describe("T23 demo data and production", () => {
  it("refuses to publish demo products when the database is a production deployment", async () => {
    await ownerQuery(`UPDATE commerce.deployment_profile SET environment = 'PRODUCTION', demo_data_allowed = false`);
    const product = await db().product.findFirstOrThrow({ where: { slug: "draft-item" } });
    await expect(db().product.update({ where: { id: product.id }, data: { publishState: "PUBLISHED" } })).rejects.toThrow(/only verified products/);
    await expect(ownerQuery(`UPDATE commerce.deployment_profile SET demo_data_allowed = true`)).rejects.toThrow(/production cannot allow demo data/);
  });

  it("refuses fixture writes outside local/test deployments", async () => {
    await ownerQuery(`UPDATE commerce.deployment_profile SET environment = 'STAGING'`);
    const { assertFixturesAllowed } = await import("@/modules/dev/fixtures");
    await expect(assertFixturesAllowed()).rejects.toThrow();
  });
});
