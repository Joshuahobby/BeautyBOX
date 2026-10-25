import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/db";
import { now } from "@/modules/shared/clock";
import { DomainError, notFound } from "@/modules/shared/errors";
import { toRwf } from "@/modules/shared/money";
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from "@/modules/idempotency/idempotency";
import { audit } from "@/modules/audit/audit";
import { can } from "@/modules/staff/capabilities";
import type { StaffIdentity } from "@/modules/staff/identity";

// Supplier attribution (I09) and manual settlement evidence (I10; API-Notes "Supplier
// records and manual settlement evidence are internal operational records. The
// settlement command records an already authorized off-platform settlement; it does not
// send money. An unvalued obligation cannot be settled until its agreement basis is
// resolved"). Suppliers never see the system and have no payout account here.

export type SupplierView = {
  id: string;
  name: string;
  agreementReference: string;
  isActive: boolean;
  version: number;
  // Addition (CC-16)
  isDemo: boolean;
};

export type SupplierObligationView = {
  id: string;
  supplierId: string;
  orderId: string;
  allocationId: string;
  basis: string;
  amountRwf: number | null;
  settlementState: "OPEN" | "SETTLED" | "DISPUTED";
  manualReference: string | null;
  version: number;
  // Additions (CC-16): what finance needs to decide without opening each order.
  supplierName: string;
  orderReference: string;
  quantity: number;
  sku: string;
  allocationState: string;
  settleable: boolean;
  blockedReason: string | null;
  settledAt: string | null;
  createdAt: string;
};

const supplierView = (s: { id: string; name: string; agreementReference: string | null; isActive: boolean; version: number; dataOrigin: string }): SupplierView => ({
  id: s.id,
  name: s.name,
  agreementReference: s.agreementReference ?? "",
  isActive: s.isActive,
  version: s.version,
  isDemo: s.dataOrigin !== "VERIFIED",
});

const obligationInclude = {
  supplier: true,
  allocation: { include: { orderLine: { include: { order: { select: { id: true, reference: true, state: true } } } } } },
} satisfies Prisma.SupplierObligationInclude;
type ObligationRow = Prisma.SupplierObligationGetPayload<{ include: typeof obligationInclude }>;

/** Why an obligation cannot be settled yet, or null. */
function settlementBlock(o: ObligationRow): string | null {
  if (o.settlementState === "SETTLED") return "Already settled.";
  if (o.amountRwf === null || o.settlementState === "UNVALUED") return "No agreed cost basis yet. Resolve the agreement value first.";
  if (o.allocation.orderLine.order.state === "CANCELLED" || o.allocation.state === "RELEASED") return "The order was cancelled before handover; nothing was sold.";
  if (o.allocation.state !== "SHIPPED") return "The goods have not been handed to the rider yet.";
  return null;
}

function obligationView(o: ObligationRow): SupplierObligationView {
  const blocked = settlementBlock(o);
  return {
    id: o.id,
    supplierId: o.supplierId,
    orderId: o.allocation.orderLine.order.id,
    allocationId: o.allocationId,
    basis: o.basis,
    amountRwf: o.amountRwf === null ? null : toRwf(o.amountRwf),
    // The contract has no UNVALUED state: an unvalued obligation is OPEN with no amount.
    settlementState: o.settlementState === "SETTLED" ? "SETTLED" : "OPEN",
    manualReference: o.manualReference,
    version: o.version,
    supplierName: o.supplier.name,
    orderReference: o.allocation.orderLine.order.reference,
    quantity: o.allocation.quantity,
    sku: o.allocation.orderLine.sku,
    allocationState: o.allocation.state,
    settleable: blocked === null,
    blockedReason: o.settlementState === "SETTLED" ? null : blocked,
    settledAt: o.settledAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}

const pageLimit = (limit?: number) => Math.min(Math.max(limit ?? 25, 1), 50);

export async function listSuppliers(input: { limit?: number; cursor?: string | null }) {
  const limit = pageLimit(input.limit);
  const rows = await db().supplier.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  return { items: rows.slice(0, limit).map(supplierView), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
}

const requireAdmin = (staff: StaffIdentity) => {
  // Contract: createSupplier / editSupplier are ADMIN only.
  if (!can(staff.role, "suppliers.write")) throw new DomainError("FORBIDDEN", "Only an administrator can change supplier records.");
};

function cleanSupplier(input: { name: string; agreementReference: string }) {
  const name = input.name.trim();
  const agreementReference = input.agreementReference.trim();
  const fieldErrors = [
    ...(name.length < 2 || name.length > 160 ? [{ field: "name", message: "Enter the supplier name (2-160 characters)." }] : []),
    ...(agreementReference.length < 1 || agreementReference.length > 120 ? [{ field: "agreementReference", message: "Enter the agreement reference." }] : []),
  ];
  if (fieldErrors.length) throw new DomainError("VALIDATION_ERROR", "Check the supplier details.", { fieldErrors });
  return { name, agreementReference };
}

export async function createSupplier(staff: StaffIdentity, input: { name: string; agreementReference: string }, key: string, requestId: string | null): Promise<SupplierView> {
  requireAdmin(staff);
  const clean = cleanSupplier(input);
  const id = await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:supplier-create`, key, requestHash: requestHash("createSupplier", clean) });
    if (claim.kind === "REPLAY") return claim.resourceId;
    const created = await tx.supplier.create({ data: { ...clean, dataOrigin: "VERIFIED" } });
    await audit(tx, { actor: { type: "STAFF", id: staff.staffId }, entityType: "supplier", entityId: created.id, action: "SUPPLIER_CREATED", after: clean, requestId });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "supplier", resourceId: created.id, responseStatus: 201 });
    return created.id;
  });
  return supplierView(await db().supplier.findUniqueOrThrow({ where: { id } }));
}

/** Agreement changes apply to future obligations only; existing amounts are never rewritten. */
export async function editSupplier(
  staff: StaffIdentity,
  supplierId: string,
  input: { expectedVersion: number; name: string; agreementReference: string; isActive: boolean; reason: string },
  key: string,
  requestId: string | null,
): Promise<SupplierView> {
  requireAdmin(staff);
  const clean = cleanSupplier(input);
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("VALIDATION_ERROR", "Give a reason.", { fieldErrors: [{ field: "reason", message: "Required." }] });
  await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:supplier-edit:${supplierId}`, key, requestHash: requestHash("editSupplier", input) });
    if (claim.kind === "REPLAY") return;
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM commerce.suppliers WHERE id = ${supplierId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw notFound();
    const current = await tx.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    if (current.version !== input.expectedVersion) throw new DomainError("VERSION_CONFLICT", "This supplier changed. Reload before editing.");
    await tx.supplier.update({ where: { id: supplierId }, data: { ...clean, isActive: input.isActive, version: { increment: 1 } } });
    await audit(tx, {
      actor: { type: "STAFF", id: staff.staffId },
      entityType: "supplier",
      entityId: supplierId,
      action: "SUPPLIER_UPDATED",
      before: { name: current.name, agreementReference: current.agreementReference, isActive: current.isActive },
      after: { ...clean, isActive: input.isActive },
      reason,
      requestId,
    });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "supplier", resourceId: supplierId, responseStatus: 200 });
  });
  return supplierView(await db().supplier.findUniqueOrThrow({ where: { id: supplierId } }));
}

export async function listObligations(input: { limit?: number; cursor?: string | null; supplierId?: string; state?: "OPEN" | "SETTLED" }) {
  const limit = pageLimit(input.limit);
  const where: Prisma.SupplierObligationWhereInput = {
    ...(input.supplierId ? { supplierId: input.supplierId } : {}),
    // VOID obligations (sale cancelled before handover) are owed to no one and never listed.
    ...(input.state === "SETTLED" ? { settlementState: "SETTLED" } : input.state === "OPEN" ? { settlementState: { in: ["OPEN", "UNVALUED"] } } : { settlementState: { not: "VOID" } }),
  };
  const rows = await db().supplierObligation.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: obligationInclude,
  });
  return { items: rows.slice(0, limit).map(obligationView), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
}

/**
 * Records that an already authorised off-platform settlement happened. Moves no money.
 * Only for valued obligations whose goods actually left with a customer.
 */
export async function recordSettlement(
  staff: StaffIdentity,
  obligationId: string,
  input: { expectedVersion: number; manualReference: string; reason: string },
  key: string,
  requestId: string | null,
): Promise<SupplierObligationView> {
  if (!can(staff.role, "suppliers.settle")) throw new DomainError("FORBIDDEN", "Only finance or an administrator can record settlements.");
  const manualReference = input.manualReference.trim();
  const reason = input.reason.trim();
  if (!manualReference) throw new DomainError("VALIDATION_ERROR", "Enter the settlement reference.", { fieldErrors: [{ field: "manualReference", message: "Required." }] });
  if (!reason) throw new DomainError("VALIDATION_ERROR", "Give a reason.", { fieldErrors: [{ field: "reason", message: "Required." }] });
  await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:obligation-settle:${obligationId}`, key, requestHash: requestHash("recordSettlement", input) });
    if (claim.kind === "REPLAY") return;
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM commerce.supplier_obligations WHERE id = ${obligationId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw notFound();
    const obligation = await tx.supplierObligation.findUniqueOrThrow({ where: { id: obligationId }, include: obligationInclude });
    if (obligation.version !== input.expectedVersion) throw new DomainError("VERSION_CONFLICT", "This obligation changed. Reload before recording a settlement.");
    const blocked = settlementBlock(obligation);
    if (blocked) throw new DomainError("ACTION_NOT_ALLOWED", blocked);
    await tx.supplierObligation.update({
      where: { id: obligationId },
      data: { settlementState: "SETTLED", manualReference, settledByStaffId: staff.staffId, settledAt: now(), version: { increment: 1 } },
    });
    await audit(tx, {
      actor: { type: "STAFF", id: staff.staffId },
      entityType: "supplier_obligation",
      entityId: obligationId,
      action: "SUPPLIER_SETTLEMENT_RECORDED",
      after: { manualReference, amountRwf: obligation.amountRwf === null ? null : toRwf(obligation.amountRwf) },
      reason,
      requestId,
    });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "supplier_obligation", resourceId: obligationId, responseStatus: 200 });
  });
  return obligationView(await db().supplierObligation.findUniqueOrThrow({ where: { id: obligationId }, include: obligationInclude }));
}
