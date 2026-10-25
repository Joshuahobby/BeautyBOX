import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { receiveStock } from "@/modules/dev/fixtures";
import { applyOrderCommand, type OrderCommand } from "@/modules/fulfillment/commands";
import type { StaffIdentity } from "@/modules/staff/identity";
import * as suppliers from "@/app/api/v1/staff/suppliers/route";
import * as supplier from "@/app/api/v1/staff/suppliers/[supplierId]/route";
import * as obligations from "@/app/api/v1/staff/supplier-obligations/route";
import * as settlement from "@/app/api/v1/staff/supplier-obligations/[obligationId]/settlement/route";
import * as settings from "@/app/api/v1/staff/settings/route";
import { DEST_5KM, addToCart, drainJobs, expectDomainError, newCustomer, ownerQuery, pay, readyCheckout, resetDatabase, seedShop, settleAndDrain, type Shop } from "./harness";

// Supplier attribution and manual settlement evidence (I09/I10) and versioned settings
// (A07, I12/I13): real route handlers and PostgreSQL.

let shop: Shop;
beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
});

type Role = "ADMIN" | "OPERATIONS" | "FINANCE" | "SUPPORT";
async function staff(role: Role): Promise<StaffIdentity & { header: string }> {
  const authUserId = randomUUID();
  const m = await db().staffMember.create({ data: { authUserId, email: `${role.toLowerCase()}-${authUserId.slice(0, 6)}@example.test`, displayName: `T ${role}`, role } });
  return { staffId: m.id, authUserId, role: m.role, displayName: m.displayName, email: m.email, roleVersion: m.roleVersion, header: `${authUserId}:aal2` };
}

async function call(route: unknown, method: string, path: string, opts: { as?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const origin = process.env.APP_ORIGIN!;
  const headers: Record<string, string> = { origin };
  if (opts.as) headers["x-test-staff"] = opts.as;
  if (method !== "GET") {
    headers["content-type"] = "application/json";
    headers["idempotency-key"] = `test-${randomUUID()}`;
  }
  const handler = route as (r: NextRequest, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
  const res = await handler(new NextRequest(`${origin}/api/v1${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), { params: Promise.resolve(opts.params ?? {}) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function paidOrder(variantId: string, qty = 1) {
  const c = await newCustomer();
  await addToCart(c, variantId, qty);
  const { attemptId } = await pay(c, await readyCheckout(c));
  await drainJobs();
  await settleAndDrain(6);
  const attempt = await db().paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  return db().order.findUniqueOrThrow({ where: { id: attempt.orderId } });
}

async function command(actor: StaffIdentity, orderId: string, cmd: Record<string, unknown>) {
  const { version } = await db().order.findUniqueOrThrow({ where: { id: orderId } });
  await applyOrderCommand(actor, orderId, { ...cmd, expectedVersion: version } as OrderCommand, `test-${randomUUID()}`, null);
}

async function handOver(ops: StaffIdentity, orderId: string) {
  await command(ops, orderId, { action: "START_PREPARATION", reason: "Packed" });
  await command(ops, orderId, { action: "ASSIGN_RIDER", reason: "Booked", riderReference: "R1" });
  await command(ops, orderId, { action: "HAND_OVER", reason: "Collected", riderReference: "R1", occurredAt: new Date().toISOString() });
}

describe("suppliers", () => {
  it("only an administrator creates or edits suppliers; operations and finance can read", async () => {
    const admin = await staff("ADMIN");
    const finance = await staff("FINANCE");
    const ops = await staff("OPERATIONS");
    const support = await staff("SUPPORT");
    const created = await call(suppliers.POST, "POST", "/staff/suppliers", { as: admin.header, body: { name: "Kigali Beauty Imports", agreementReference: "AGR-2026-01" } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Kigali Beauty Imports", agreementReference: "AGR-2026-01", isActive: true, version: 1, isDemo: false });
    expect((await call(suppliers.POST, "POST", "/staff/suppliers", { as: finance.header, body: { name: "X Co", agreementReference: "A" } })).status).toBe(403);
    expect((await call(suppliers.GET, "GET", "/staff/suppliers", { as: ops.header })).status).toBe(200);
    expect((await call(suppliers.GET, "GET", "/staff/suppliers", { as: support.header })).status).toBe(403);
    const id = String(created.body.id);
    const stale = await call(supplier.PATCH, "PATCH", `/staff/suppliers/${id}`, { as: admin.header, params: { supplierId: id }, body: { expectedVersion: 9, name: "Renamed", agreementReference: "AGR-2", isActive: true, reason: "r" } });
    expect(stale.status).toBe(409);
    const edited = await call(supplier.PATCH, "PATCH", `/staff/suppliers/${id}`, { as: admin.header, params: { supplierId: id }, body: { expectedVersion: 1, name: "Kigali Beauty Imports Ltd", agreementReference: "AGR-2026-02", isActive: false, reason: "New agreement" } });
    expect(edited.body).toMatchObject({ version: 2, isActive: false, agreementReference: "AGR-2026-02" });
    expect(await db().auditEvent.count({ where: { entityType: "supplier", entityId: id } })).toBe(2);
  });

  it("a consigned sale creates a valued obligation that can be settled only after handover, once, and never re-valued by agreement edits", async () => {
    const admin = await staff("ADMIN");
    const finance = await staff("FINANCE");
    const ops = await staff("OPERATIONS");
    const order = await paidOrder(shop.cleanser.id); // FEFO takes the consigned lot (cost 9,000)
    let list = await call(obligations.GET, "GET", "/staff/supplier-obligations", { as: finance.header });
    expect(list.status).toBe(200);
    let item = (list.body.items as Record<string, unknown>[])[0]!;
    expect(item).toMatchObject({ orderId: order.id, amountRwf: 9000, settlementState: "OPEN", allocationState: "COMMITTED", settleable: false, quantity: 1, sku: "T-CLEANSER" });
    const early = await call(settlement.POST, "POST", `/staff/supplier-obligations/${item.id}/settlement`, { as: finance.header, params: { obligationId: String(item.id) }, body: { expectedVersion: item.version, manualReference: "MOMO-TX-1", reason: "Paid" } });
    expect(early.status).toBe(409);

    // An agreement edit does not rewrite the recorded amount.
    const sup = await db().supplier.findFirstOrThrow({ where: { name: "Test supplier" } });
    await call(supplier.PATCH, "PATCH", `/staff/suppliers/${sup.id}`, { as: admin.header, params: { supplierId: sup.id }, body: { expectedVersion: sup.version, name: sup.name, agreementReference: "NEW-TERMS", isActive: true, reason: "Renegotiated" } });

    await handOver(ops, order.id);
    list = await call(obligations.GET, "GET", "/staff/supplier-obligations?state=OPEN", { as: finance.header });
    item = (list.body.items as Record<string, unknown>[])[0]!;
    expect(item).toMatchObject({ amountRwf: 9000, allocationState: "SHIPPED", settleable: true, blockedReason: null });
    expect((await call(obligations.GET, "GET", "/staff/supplier-obligations", { as: ops.header })).status).toBe(403);
    const settled = await call(settlement.POST, "POST", `/staff/supplier-obligations/${item.id}/settlement`, { as: finance.header, params: { obligationId: String(item.id) }, body: { expectedVersion: item.version, manualReference: "MOMO-TX-1", reason: "Paid per agreement" } });
    expect(settled.status).toBe(200);
    expect(settled.body).toMatchObject({ settlementState: "SETTLED", manualReference: "MOMO-TX-1", settleable: false });
    const again = await call(settlement.POST, "POST", `/staff/supplier-obligations/${item.id}/settlement`, { as: finance.header, params: { obligationId: String(item.id) }, body: { expectedVersion: settled.body.version, manualReference: "MOMO-TX-2", reason: "dup" } });
    expect(again.status).toBe(409);
  });

  it("a cancelled order's obligation and an unvalued obligation cannot be settled", async () => {
    const finance = await staff("FINANCE");
    const ops = await staff("OPERATIONS");
    const cancelled = await paidOrder(shop.cleanser.id);
    await command(ops, cancelled.id, { action: "CANCEL", reason: "Customer request" });
    // A consigned lot without an agreed cost basis.
    const sup = await db().supplier.findFirstOrThrow({ where: { name: "Test supplier" } });
    await receiveStock({ variantId: shop.last.id, locationId: shop.location.id, quantity: 2, ownership: "CONSIGNED", supplierId: sup.id, costBasisRwf: null, expiryDate: "2026-12-01", batchReference: "U-1", dataOrigin: "SYNTHETIC_DEMO" });
    const unvaluedOrder = await paidOrder(shop.last.id, 1);
    void unvaluedOrder;
    const list = await call(obligations.GET, "GET", "/staff/supplier-obligations", { as: finance.header });
    const items = list.body.items as Record<string, unknown>[];
    // RF-10: the cancelled sale's obligation is VOID (nothing was sold) and is not listed.
    expect(items.find((i) => i.orderId === cancelled.id)).toBeUndefined();
    const voided = await db().supplierObligation.findFirstOrThrow({ where: { allocation: { orderLine: { orderId: cancelled.id } } } });
    expect(voided.settlementState).toBe("VOID");
    const unvalued = items.find((i) => i.amountRwf === null);
    // The lot with the earliest expiry is used first (FEFO), so the unvalued lot is taken.
    expect(unvalued).toMatchObject({ settlementState: "OPEN", settleable: false, basis: "UNVALUED" });
    expect(String(unvalued!.blockedReason)).toMatch(/cost basis/);
    const res = await call(settlement.POST, "POST", `/staff/supplier-obligations/${voided.id}/settlement`, { as: finance.header, params: { obligationId: voided.id }, body: { expectedVersion: voided.version, manualReference: "X", reason: "x" } });
    expect(res.status).toBe(409);
    const unvaluedTry = await call(settlement.POST, "POST", `/staff/supplier-obligations/${unvalued!.id}/settlement`, { as: finance.header, params: { obligationId: String(unvalued!.id) }, body: { expectedVersion: unvalued!.version, manualReference: "X", reason: "x" } });
    expect(unvaluedTry.status).toBe(409);
  });
});

describe("settings (A07)", () => {
  function editable(view: Record<string, unknown>) {
    const { version: _v, publicationBlocks: _p, ...rest } = view;
    return rest as Record<string, unknown> & { tariff: Record<string, unknown> };
  }

  it("is versioned: a tariff change creates a new immutable version, stale quotes are refused and orders keep their fee", async () => {
    const admin = await staff("ADMIN");
    const finance = await staff("FINANCE");
    const support = await staff("SUPPORT");
    const before = await call(settings.GET, "GET", "/staff/settings", { as: finance.header });
    expect(before.status).toBe(200);
    expect(before.body.publicationBlocks).toEqual(expect.arrayContaining(["TARIFF_NOT_APPROVED", "ORIGIN_NOT_APPROVED", "POLICIES_NOT_APPROVED"]));
    expect((await call(settings.GET, "GET", "/staff/settings", { as: support.header })).status).toBe(403);
    expect((await call(settings.PUT, "PUT", "/staff/settings", { as: finance.header, body: { expectedVersion: 1, settings: editable(before.body), reason: "x" } })).status).toBe(403);

    // A customer is mid-checkout with a quote, and an earlier order is already placed.
    const placed = await paidOrder(shop.cleanser.id);
    const c = await newCustomer();
    await addToCart(c, shop.cleanser.id, 1);
    const ready = await readyCheckout(c, DEST_5KM);
    expect(ready.quote.amountRwf).toBe(2100);

    const next = editable(before.body);
    const put = await call(settings.PUT, "PUT", "/staff/settings", {
      as: admin.header,
      body: { expectedVersion: before.body.version, settings: { ...next, tariff: { ...next.tariff, baseRwf: 2000 }, publicationBlocks: [] }, reason: "Rider rates rose" },
    });
    expect(put.status).toBe(200);
    expect(put.body.version).toBe(Number(before.body.version) + 1);
    expect((put.body.tariff as Record<string, unknown>).version).toBe(2);
    // Server-owned blocks are recomputed, never taken from input.
    expect(put.body.publicationBlocks).toEqual(expect.arrayContaining(["TARIFF_NOT_APPROVED"]));
    expect(await db().tariff.count()).toBe(2);
    await expectDomainError(pay(c, ready), "QUOTE_INVALID");
    const fresh = await readyCheckout(c, DEST_5KM);
    expect(fresh.quote.amountRwf).toBe(2600); // ceil100(2000 + 300 * 2)
    expect(Number((await db().order.findUniqueOrThrow({ where: { id: placed.id } })).deliveryRwf)).toBe(2100);
    expect(await db().auditEvent.count({ where: { action: "SETTINGS_UPDATED" } })).toBe(1);

    const stale = await call(settings.PUT, "PUT", "/staff/settings", { as: admin.header, body: { expectedVersion: before.body.version, settings: next, reason: "late" } });
    expect(stale.status).toBe(409);
  });

  it("validates the pin, area and parcel rules, and approvals clear their release blocks", async () => {
    const admin = await staff("ADMIN");
    let current = (await call(settings.GET, "GET", "/staff/settings", { as: admin.header })).body;
    const put = (settingsBody: Record<string, unknown>) =>
      call(settings.PUT, "PUT", "/staff/settings", { as: admin.header, body: { expectedVersion: current.version, settings: settingsBody, reason: "Founder inputs B03/B04/B09" } });
    const base = editable(current);
    expect((await put({ ...base, origin: { lat: 48.85, lng: 2.35 } })).status).toBe(422);
    expect((await put({ ...base, coverageGeoJson: { type: "MultiPolygon", coordinates: [[[[30, -1.9], [30.1, -1.9], [30.1, -2], [30, -1.9]]], [[[30, -1.9], [30.1, -1.9], [30.1, -2], [30, -1.9]]]] } })).status).toBe(422);
    expect((await put({ ...base, parcelLimits: { maxWeightGrams: 5000, maxItems: 10, allowedClasses: ["STANDARD", "BULKY"] } })).status).toBe(422);

    const approved = await put({
      ...base,
      originLabel: "BeautyBOX shop, Kimironko",
      dispatchHours: "Mon-Sat 09:00-18:00",
      supportPhone: "+250788000111",
      supportEmail: "help@example.test",
      deliveryPromise: "Same day for orders before 14:00",
      tariff: { ...base.tariff, approved: true },
      parcelLimits: { maxWeightGrams: 5000, maxItems: 10, allowedClasses: ["STANDARD"] },
      originApproved: true,
      policiesApproved: true,
    });
    expect(approved.status).toBe(200);
    expect(approved.body.publicationBlocks).toEqual(["LIVE_PAYMENTS_DISABLED", "PAYMENT_ADAPTER_NOT_LIVE", "ROUTING_ADAPTER_NOT_LIVE"]);
    expect(approved.body).toMatchObject({ originApproved: true, policiesApproved: true, dispatchHours: "Mon-Sat 09:00-18:00", parcelLimits: { maxItems: 10, maxWeightGrams: 5000, allowedClasses: ["STANDARD"] } });
    const location = await db().dispatchLocation.findFirstOrThrow();
    expect(location.version).toBe(2);

    // In a production profile live payments cannot be switched on while blocks remain.
    current = approved.body;
    await ownerQuery(`UPDATE commerce.deployment_profile SET environment = 'PRODUCTION', demo_data_allowed = false`);
    try {
      const live = await put({ ...editable(current), livePaymentsEnabled: true });
      expect(live.status).toBe(409);
      expect(live.body.code).toBe("PUBLICATION_BLOCKED");
    } finally {
      await ownerQuery(`UPDATE commerce.deployment_profile SET environment = 'TEST', demo_data_allowed = true`);
    }
    expect((await db().settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } })).livePaymentsEnabled).toBe(false);
  });
});
