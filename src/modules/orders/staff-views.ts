import "server-only";
import type { OrderState, Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { notFound } from "@/modules/shared/errors";
import { toRwf } from "@/modules/shared/money";
import { can } from "@/modules/staff/capabilities";
import type { StaffIdentity } from "@/modules/staff/identity";
import { receiptBudget } from "@/modules/refunds/refunds";
import { NOT_DELIVERED, smsProblemWhere, type DeliveryStatus } from "@/modules/notifications/delivery-reports";

// Staff order projections (A01/A02, contract StaffOrder). Payment and fulfilment are shown
// as separate facts. Contact and destination are visible only to roles whose work needs
// them; supplier costs and payer numbers are never shown here.

export type StaffOrderView = {
  id: string;
  reference: string;
  version: number;
  state: OrderState;
  paymentState: string;
  lines: { title: string; sku: string; attributes: Record<string, string>; quantity: number; unitPriceRwf: number; lineTotalRwf: number }[];
  productsRwf: number;
  deliveryRwf: number;
  totalRwf: number;
  currency: "RWF";
  recipient: { name: string; phone: string; landmark?: string; instructions?: string };
  /** Null for roles without contact access (CC-11). */
  destination: { lat: number; lng: number } | null;
  createdAt: string;
  refunds: {
    id: string;
    amountRwf: number;
    state: string;
    version: number;
    reason: string;
    receiptId: string;
    verificationFlag: string | null;
    providerAmountRwf: number | null;
    // Additions (CC-19): what finance looks up in the provider's dashboard, and the provider
    // reference finance recorded when it resolved a review as paid by the provider.
    providerRefundId: string | null;
    failureCode: string | null;
    resolutionReference: string | null;
  }[];
  allocationState: "UNALLOCATED" | "RESERVED" | "COMMITTED" | "SHIPPED" | "RELEASED";
  riderReference: string | null;
  exceptions: string[];
  audit: { occurredAt: string; action: string; actorLabel: string; reason: string | null }[];
  // Additions (CC-11)
  isDemo: boolean;
  holdReason: string | null;
  deliveryState: string | null;
  contactVisible: boolean;
  cancellationRequest: { operationId: string; reason: string; requestedAt: string } | null;
  /** `providerPaymentId` (CC-19): the payment's id at the provider (pawaPay depositId), for its dashboard. */
  receipts: { id: string; amountRwf: number; disposition: string; verifiedAt: string; remainingRefundableRwf: number; providerPaymentId: string }[];
  attempts: { id: string; state: string; verificationFlag: string | null; method: string; createdAt: string }[];
  /** `deliveryStatus` (CC-21): handset delivery as later reported by the SMS provider (DR-048). */
  notifications: { event: string; state: string; lastErrorCode: string | null; deliveryStatus: string | null; deliveryFailureReason: string | null; createdAt: string }[];
  deliveryAttempts: { outcome: string; occurredAt: string; custody: string | null; reason: string | null }[];
};

/** Contract-valid masked phone: the last two digits only (+2507******12). */
const maskPhone = (phone: string) => `+2507******${phone.slice(-2)}`;

// Free-text reasons on these actions are written by fulfilment/support staff and can carry
// contact or address details; roles without contact access do not see them (RF-23).
const CONTACT_BEARING_ACTIONS = new Set([
  "ORDER_ASSIGN_RIDER",
  "ORDER_HAND_OVER",
  "ORDER_CONFIRM_DELIVERY",
  "ORDER_RECORD_FAILED_ATTEMPT",
  "ORDER_HOLD",
  "ORDER_CANCEL",
  "ORDER_START_PREPARATION",
  "CANCELLATION_REQUESTED",
  "ORDER_ACCESS_REISSUED",
]);

export async function listStaffOrders(input: { state?: OrderState; reference?: string; from?: Date; to?: Date; limit?: number; cursor?: string | null; cancellationRequested?: boolean }) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const where: Prisma.OrderWhereInput = {
    ...(input.state ? { state: input.state } : {}),
    ...(input.reference ? { reference: { contains: input.reference.trim().toUpperCase() } } : {}),
    ...(input.cancellationRequested ? { operations: { some: { type: "CANCELLATION_REQUEST", state: "PENDING" } } } : {}),
    ...(input.from || input.to ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
  };
  const rows = await db().order.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: {
      lines: true,
      fulfillment: true,
      attempts: { orderBy: { createdAt: "desc" }, take: 1 },
      operations: { where: { type: "CANCELLATION_REQUEST", state: "PENDING" }, take: 1 },
      notifications: { where: smsProblemWhere, take: 1 },
    },
  });
  return {
    items: rows.slice(0, limit).map((o) => ({
      id: o.id,
      reference: o.reference,
      version: o.version,
      state: o.state,
      paymentState: o.paymentState,
      totalRwf: toRwf(o.totalRwf),
      itemCount: o.lines.filter((l) => l.snapshotRevision === o.snapshotRevision).reduce((n, l) => n + l.quantity, 0),
      deliveryState: o.fulfillment?.state ?? null,
      holdReason: o.holdReason,
      createdAt: o.createdAt.toISOString(),
      isDemo: o.dataOrigin !== "VERIFIED",
      attentionFlag: o.attempts[0]?.verificationFlag ?? null,
      cancellationRequested: o.operations.length > 0,
      smsProblem: o.notifications.length > 0,
    })),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
  };
}

export async function getStaffOrder(staff: StaffIdentity, orderId: string): Promise<StaffOrderView> {
  const order = await db().order.findUnique({
    where: { id: orderId },
    include: {
      lines: { include: { allocations: true } },
      fulfillment: true,
      attempts: { orderBy: { createdAt: "asc" } },
      refundCases: { include: { refunds: { orderBy: { createdAt: "asc" } } } },
      receipts: { orderBy: { verifiedAt: "asc" } },
      operations: { where: { type: "CANCELLATION_REQUEST", state: "PENDING" }, take: 1 },
      notifications: { orderBy: { createdAt: "asc" } },
      deliveryAttempts: { orderBy: { occurredAt: "asc" } },
    },
  });
  if (!order) throw notFound();
  const lines = order.lines.filter((l) => l.snapshotRevision === order.snapshotRevision);
  const allocations = lines.flatMap((l) => l.allocations);
  const allocationState: StaffOrderView["allocationState"] =
    allocations.length === 0
      ? (await db().reservation.count({ where: { orderId, state: "ACTIVE" } })) > 0
        ? "RESERVED"
        : "UNALLOCATED"
      : allocations.every((a) => a.state === "SHIPPED")
        ? "SHIPPED"
        : allocations.every((a) => a.state === "RELEASED")
          ? "RELEASED"
          : "COMMITTED";
  const exceptions: string[] = [];
  for (const a of order.attempts) if (a.verificationFlag) exceptions.push(`PAYMENT_${a.verificationFlag}`);
  if (order.holdReason) exceptions.push(`HOLD_${order.holdReason}`);
  if (order.refundCases.some((c) => c.state === "OPEN")) exceptions.push("REFUND_CASE_OPEN");
  if (order.refundCases.some((c) => c.refunds.some((r) => r.verificationFlag === "MISMATCH"))) exceptions.push("REFUND_AMOUNT_MISMATCH");
  if (order.refundCases.some((c) => c.refunds.some((r) => r.verificationFlag === "NEEDS_REVIEW"))) exceptions.push("REFUND_NEEDS_REVIEW");
  if (order.operations.length > 0) exceptions.push("CANCELLATION_REQUESTED");
  if (order.notifications.some((n) => n.state === "FAILED")) exceptions.push("SMS_FAILED");
  if (order.notifications.some((n) => n.state === "UNKNOWN")) exceptions.push("SMS_OUTCOME_UNKNOWN");
  if (order.notifications.some((n) => n.deliveryStatus !== null && NOT_DELIVERED.includes(n.deliveryStatus as DeliveryStatus))) exceptions.push("SMS_NOT_DELIVERED_TO_PHONE");
  const receipts = [];
  for (const r of order.receipts) {
    const budget = await receiptBudget(db(), r.id);
    const attempt = order.attempts.find((a) => a.id === r.attemptId);
    receipts.push({
      id: r.id,
      amountRwf: budget.collected,
      disposition: r.disposition,
      verifiedAt: r.verifiedAt.toISOString(),
      remainingRefundableRwf: budget.remaining,
      providerPaymentId: attempt?.providerDepositId ?? r.evidenceRef,
    });
  }
  const request = order.operations[0] ?? null;
  const contactVisible = can(staff.role, "orders.readContact");
  const auditRows = await db().auditEvent.findMany({ where: { entityType: "order", entityId: orderId }, orderBy: { occurredAt: "asc" }, take: 100 });
  const staffIds = [...new Set(auditRows.filter((r) => r.actorType === "STAFF" && r.actorId).map((r) => r.actorId!))];
  const names = new Map((await db().staffMember.findMany({ where: { id: { in: staffIds } } })).map((m) => [m.id, m.displayName]));
  return {
    id: order.id,
    reference: order.reference,
    version: order.version,
    state: order.state,
    paymentState: order.paymentState,
    lines: lines.map((l) => ({
      title: l.title,
      sku: l.sku,
      attributes: l.attributes as Record<string, string>,
      quantity: l.quantity,
      unitPriceRwf: toRwf(l.unitPriceRwf),
      lineTotalRwf: toRwf(l.lineTotalRwf),
    })),
    productsRwf: toRwf(order.productsRwf),
    deliveryRwf: toRwf(order.deliveryRwf),
    totalRwf: toRwf(order.totalRwf),
    currency: "RWF",
    recipient: contactVisible
      ? {
          name: order.recipientName,
          phone: order.recipientPhone,
          ...(order.landmark ? { landmark: order.landmark } : {}),
          ...(order.instructions ? { instructions: order.instructions } : {}),
        }
      : { name: order.recipientName, phone: maskPhone(order.recipientPhone) },
    destination: contactVisible ? { lat: Number(order.destinationLat), lng: Number(order.destinationLng) } : null,
    createdAt: order.createdAt.toISOString(),
    refunds: order.refundCases
      .flatMap((c) => c.refunds)
      .map((r) => ({
        id: r.id,
        amountRwf: toRwf(r.amountRwf),
        state: r.state,
        version: r.version,
        reason: r.reason,
        receiptId: r.receiptId,
        verificationFlag: r.verificationFlag,
        providerAmountRwf: r.providerAmountRwf === null ? null : toRwf(r.providerAmountRwf),
        providerRefundId: r.providerRefundId,
        failureCode: r.failureCode,
        resolutionReference: r.resolutionReference,
      })),
    allocationState,
    riderReference: order.fulfillment?.riderReference ?? null,
    exceptions,
    audit: auditRows.map((r) => ({
      occurredAt: r.occurredAt.toISOString(),
      action: r.action,
      actorLabel: r.actorType === "STAFF" ? (names.get(r.actorId ?? "") ?? "Staff") : r.actorType === "CUSTOMER" ? "Customer" : r.actorType === "PROVIDER" ? "Payment provider" : "System",
      reason: contactVisible || !CONTACT_BEARING_ACTIONS.has(r.action) ? r.reason : null,
    })),
    isDemo: order.dataOrigin !== "VERIFIED",
    holdReason: order.holdReason,
    deliveryState: order.fulfillment?.state ?? null,
    contactVisible,
    cancellationRequest: request ? { operationId: request.id, reason: request.reason, requestedAt: request.createdAt.toISOString() } : null,
    receipts,
    attempts: order.attempts.map((a) => ({ id: a.id, state: a.state, verificationFlag: a.verificationFlag, method: a.method, createdAt: a.createdAt.toISOString() })),
    notifications: order.notifications.map((n) => ({
      event: n.event,
      state: n.state,
      lastErrorCode: n.lastErrorCode,
      deliveryStatus: n.deliveryStatus,
      deliveryFailureReason: n.deliveryFailureReason,
      createdAt: n.createdAt.toISOString(),
    })),
    deliveryAttempts: order.deliveryAttempts.map((d) => ({ outcome: d.outcome, occurredAt: d.occurredAt.toISOString(), custody: d.goodsCustody, reason: contactVisible ? d.reason : null })),
  };
}
