import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { db } from "@/server/db";
import { setClockForTests } from "@/modules/shared/clock";
import { createCategory, createProduct, seedBaseConfiguration } from "@/modules/dev/fixtures";
import { createOrReuseGuestSession, type GuestSession } from "@/modules/session/guest-session";
import { getCartView, setCartLine } from "@/modules/cart/cart";
import { createOrReuseCheckout, updateCheckout } from "@/modules/checkout/checkout";
import { requestQuote } from "@/modules/delivery/quote";
import { startPayment } from "@/modules/payments/start-payment";
import { runDueJobs } from "@/modules/jobs/worker";
import { clearPaymentMethodCache } from "@/modules/payments/methods";
import { setAdaptersForTests } from "@/adapters/registry";
import { FAKE_ROUTE_FIXTURES } from "@/adapters/routing/fake";

// Shared integration-test harness. Everything runs against the real PostgreSQL test
// database with the real domain modules; only the external providers are the
// deterministic fakes (which keep their own state in the devsim schema).

export const PHONES = {
  success: "+250788123000",
  fail: "+250788123001",
  neverSettles: "+250788123002",
  reject: "+250788123003",
  lostResponse: "+250788123004",
  mismatch: "+250788123006",
} as const;

export const DEST_5KM = FAKE_ROUTE_FIXTURES[2]!.point; // 5.0 km -> RWF 2,100
export const DEST_3KM = FAKE_ROUTE_FIXTURES[0]!.point; // 3.0 km -> RWF 1,500
export const DEST_ROUTE_DOWN = FAKE_ROUTE_FIXTURES[3]!.point;
export const DEST_NO_ROUTE = FAKE_ROUTE_FIXTURES[4]!.point;
export const DEST_OUTSIDE = { lat: -1.499646, lng: 29.634962 }; // Musanze: outside demo coverage

export const key = () => `test-${randomUUID()}`;

let offsetMs = 0;
setClockForTests(() => new Date(Date.now() + offsetMs));
export function advanceSeconds(seconds: number) {
  offsetMs += seconds * 1000;
}

export async function ownerQuery(sql: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

export async function resetDatabase() {
  offsetMs = 0;
  setAdaptersForTests({});
  clearPaymentMethodCache();
  const { rows } = await ownerQuery(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'commerce' AND tablename NOT IN ('deployment_profile', '_prisma_migrations')`,
  );
  const tables = rows.map((r: { tablename: string }) => `commerce."${r.tablename}"`).join(", ");
  await ownerQuery(`TRUNCATE ${tables}, devsim.refunds, devsim.deposits, devsim.sms_messages RESTART IDENTITY CASCADE`);
  await ownerQuery(`UPDATE devsim.settings SET enabled_methods = ARRAY['MTN_MOMO_RWA', 'AIRTEL_RWA']`);
  await ownerQuery(`UPDATE commerce.deployment_profile SET environment = 'TEST', demo_data_allowed = true`);
  fs.rmSync(path.resolve(process.cwd(), ".local", "media", "test"), { recursive: true, force: true });
}

export type Shop = Awaited<ReturnType<typeof seedShop>>;

export async function seedShop(opts: { reservationTtlSeconds?: number; checkoutEnabled?: boolean } = {}) {
  const base = await seedBaseConfiguration(opts);
  const supplier = await db().supplier.create({ data: { name: "Test supplier", agreementReference: "T-AGR", dataOrigin: "SYNTHETIC_DEMO" } });
  await createCategory({ slug: "skincare", title: "Skincare" });
  await createCategory({ slug: "cleansers", title: "Cleansers", parentSlug: "skincare" });
  await createCategory({ slug: "makeup", title: "Makeup" });
  const common = { sellerId: base.seller.id, locationId: base.location.id, dataOrigin: "SYNTHETIC_DEMO" as const, brand: "Test Brand", description: "Test product" };
  const cleanser = await createProduct({
    ...common, categorySlug: "cleansers", slug: "test-cleanser", title: "Test Cleanser",
    variants: [{ sku: "T-CLEANSER", priceRwf: 15000, lots: [
      { quantity: 6, expiryDate: "2027-09-30", batch: "C-OWNED" },
      { quantity: 4, supplierId: supplier.id, costBasisRwf: 9000, expiryDate: "2027-06-30", batch: "C-CONSIGNED" },
    ] }],
  });
  const lip = await createProduct({
    ...common, categorySlug: "makeup", slug: "test-lip", title: "Test Lip", optionLabel: "Shade", packSize: "5 g",
    variants: [
      { sku: "T-LIP-BROWNIE", attributes: { shade: "Brownie" }, priceRwf: 12000, lots: [{ quantity: 3 }] },
      { sku: "T-LIP-ROYAL", attributes: { shade: "Royal" }, priceRwf: 12000, lots: [] },
    ],
  });
  const last = await createProduct({
    ...common, categorySlug: "skincare", slug: "last-unit-serum", title: "Last Unit Serum",
    variants: [{ sku: "T-LAST", priceRwf: 20000, lots: [{ quantity: 1 }] }],
  });
  const bulky = await createProduct({
    ...common, categorySlug: "skincare", slug: "bulky-item", title: "Bulky Item",
    variants: [{ sku: "T-BULKY", priceRwf: 50000, parcelClass: "BULKY", lots: [{ quantity: 2 }] }],
  });
  const draft = await createProduct({
    ...common, categorySlug: "skincare", slug: "draft-item", title: "Draft Item", publish: false,
    variants: [{ sku: "T-DRAFT", priceRwf: 5000, lots: [{ quantity: 5 }] }],
  });
  return {
    ...base,
    supplier,
    cleanser: cleanser.variants[0]!,
    lipBrownie: lip.variants[0]!,
    lipRoyal: lip.variants[1]!,
    last: last.variants[0]!,
    bulky: bulky.variants[0]!,
    draft: draft.variants[0]!,
  };
}

export async function newCustomer(): Promise<GuestSession & { token: string }> {
  const { session, token } = await createOrReuseGuestSession(null);
  return Object.assign(session, { token: token! });
}

export async function addToCart(session: GuestSession, variantId: string, quantity: number) {
  const cart = await getCartView(session);
  return setCartLine(session, { variantId, quantity, expectedVersion: cart.version }, key());
}

export async function readyCheckout(session: GuestSession, destination = DEST_5KM) {
  const cart = await getCartView(session);
  let checkout = await createOrReuseCheckout(session, { cartId: cart.id, expectedCartVersion: cart.version }, key());
  checkout = await updateCheckout(
    session,
    checkout.id,
    {
      expectedRevision: checkout.revision,
      recipient: { name: "Test Recipient", phone: "+250788555111", landmark: "Blue gate" },
      destination,
      destinationConfirmed: "CUSTOMER_CONFIRMED",
    },
    key(),
  );
  const quote = await requestQuote(session, checkout.id, { expectedRevision: checkout.revision }, key());
  return { checkout, quote, total: cart.subtotalRwf + quote.amountRwf };
}

export async function pay(
  session: GuestSession,
  ready: Awaited<ReturnType<typeof readyCheckout>>,
  options: { phone?: string; idempotencyKey?: string; acceptedTotalRwf?: number; method?: "MTN_MOMO_RWA" | "AIRTEL_RWA" } = {},
) {
  return startPayment(
    session,
    ready.checkout.id,
    {
      expectedRevision: ready.checkout.revision,
      quoteId: ready.quote.id,
      acceptedTotalRwf: options.acceptedTotalRwf ?? ready.total,
      method: options.method ?? "MTN_MOMO_RWA",
      payerPhone: options.phone ?? PHONES.success,
    },
    options.idempotencyKey ?? key(),
    null,
  );
}

/** Run the durable worker until nothing is due right now. */
export async function drainJobs(rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    const result = await runDueJobs({ batchSize: 50, maxRuntimeMs: 30_000 });
    if (result.claimed === 0) break;
  }
}

/** Let the simulated provider settle, then run the checks that are now due. */
export async function settleAndDrain(seconds = 6) {
  advanceSeconds(seconds);
  await drainJobs();
}

export async function lotTotals(variantId: string) {
  const lots = await db().inventoryLot.findMany({ where: { variantId } });
  return lots.reduce(
    (t, l) => ({ onHand: t.onHand + l.quantityOnHand, reserved: t.reserved + l.reservedQty, committed: t.committed + l.committedQty }),
    { onHand: 0, reserved: 0, committed: 0 },
  );
}

/** Every lot's columns must equal the sum of its ledger movements. */
export async function ledgerMismatches(): Promise<number> {
  const rows = await db().$queryRaw<{ mismatches: bigint }[]>`
    SELECT COUNT(*) AS mismatches FROM commerce.inventory_lots l
      LEFT JOIN (SELECT lot_id, SUM(on_hand_delta) oh, SUM(reserved_delta) rs, SUM(committed_delta) cm
                   FROM commerce.inventory_movements GROUP BY lot_id) m ON m.lot_id = l.id
     WHERE l.quantity_on_hand <> COALESCE(m.oh, 0) OR l.reserved_qty <> COALESCE(m.rs, 0) OR l.committed_qty <> COALESCE(m.cm, 0)`;
  return Number(rows[0]!.mismatches);
}

export async function expectDomainError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    const actual = (error as { code?: string }).code;
    if (actual !== code) throw new Error(`expected ${code}, got ${actual ?? String(error)}`);
    return error;
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}
