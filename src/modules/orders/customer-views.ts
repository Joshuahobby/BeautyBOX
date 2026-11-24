import "server-only";
import { db } from "@/server/db";
import { notFound } from "@/modules/shared/errors";
import { toRwf } from "@/modules/shared/money";
import { now } from "@/modules/shared/clock";
import { canViewOrder, type OrderViewer } from "./access";
import { rescheduleJob } from "@/modules/jobs/outbox";
import { PAYMENT_CHECK_KEY } from "@/modules/payments/start-payment";
import { transaction } from "@/server/db";
import { nextCheckDelaySeconds } from "@/modules/payments/handlers";

export type PaymentAttemptView = {
  id: string;
  orderId: string;
  state: "CREATED" | "PENDING" | "SUCCEEDED" | "FAILED";
  verificationFlag: "UNKNOWN" | "MISMATCH" | "NEEDS_REVIEW" | null;
  amountRwf: number;
  currency: "RWF";
  method: "MTN_MOMO_RWA" | "AIRTEL_RWA";
  payerPhoneMasked: string;
  statusUrl: string;
  nextCheckAfterSeconds: number;
  // Additions (docs/CONTRACT-CHANGES.md CC-03)
  orderReference: string;
  orderState: string;
  createdAt: string;
};

export async function getPaymentAttemptView(attemptId: string, viewer: OrderViewer): Promise<PaymentAttemptView> {
  const attempt = await db().paymentAttempt.findUnique({ where: { id: attemptId }, include: { order: true } });
  if (!attempt || !(await canViewOrder(attempt.orderId, viewer))) throw notFound();

  const unresolved = attempt.state === "CREATED" || attempt.state === "PENDING";
  if (unresolved) {
    // A status read may pull the next authoritative check forward (bounded by the job's own cadence).
    if (!attempt.nextCheckAt || attempt.nextCheckAt <= now()) {
      await transaction((tx) => rescheduleJob(tx, PAYMENT_CHECK_KEY(attempt.providerDepositId), now()));
    }
  }
  return {
    id: attempt.id,
    orderId: attempt.orderId,
    state: attempt.state,
    verificationFlag: attempt.verificationFlag,
    amountRwf: toRwf(attempt.amountRwf),
    currency: "RWF",
    method: attempt.method,
    payerPhoneMasked: attempt.payerPhoneMasked,
    statusUrl: `/api/v1/payments/${attempt.id}`,
    nextCheckAfterSeconds: unresolved ? Math.min(30, nextCheckDelaySeconds(attempt.checkCount)) : 300,
    orderReference: attempt.order.reference,
    orderState: attempt.order.state,
    createdAt: attempt.createdAt.toISOString(),
  };
}

export type CustomerOrderView = {
  id: string;
  reference: string;
  version: number;
  state: string;
  paymentState: string;
  lines: { title: string; sku: string; attributes: Record<string, string>; quantity: number; unitPriceRwf: number; lineTotalRwf: number }[];
  productsRwf: number;
  deliveryRwf: number;
  totalRwf: number;
  currency: "RWF";
  recipient: { name: string; phone: string; email?: string; landmark?: string; instructions?: string };
  destination: { lat: number; lng: number };
  createdAt: string;
  refunds: { id: string; amountRwf: number; state: string }[];
  // Additions (CC-04)
  isDemo: boolean;
  holdReason: string | null;
  paidAt: string | null;
  latestAttempt: { id: string; state: string } | null;
  fulfillment: { state: string; deliveredAt: string | null; promisedWindowStart: string | null; promisedWindowEnd: string | null } | null;
  // Additions (CC-04, I09/I11)
  cancellationRequest: { operationId: string; state: "PENDING" | "SUCCEEDED" | "FAILED"; outcome: string | null } | null;
  canRequestCancellation: boolean;
  /** True only for the browser session that placed a paid order (CC-08). */
  canCreatePrivateLink: boolean;
};

/**
 * What the customer is told about refunds (RF-17): nothing until a refund is approved
 * (a request may still be rejected); a provider-confirmed refund with a different amount
 * is "under review" (no amount is promised); a failed refund that was followed by
 * another refund from the same payment is no longer shown.
 */
function customerRefunds(refunds: { id: string; receiptId: string; amountRwf: bigint; state: string; verificationFlag: string | null; createdAt: Date }[]) {
  const visible = refunds.filter((r) => r.state !== "REQUESTED" && r.state !== "REJECTED");
  return visible
    // A failed refund still under finance review is never "replaced": its money may have left.
    .filter((r) => r.state !== "FAILED" || r.verificationFlag === "NEEDS_REVIEW" || !visible.some((o) => o.receiptId === r.receiptId && o.state !== "FAILED" && o.createdAt > r.createdAt))
    .map((r) => ({
      id: r.id,
      amountRwf: toRwf(r.amountRwf),
      // A failed refund under finance review may still have paid out (DR-043).
      state: r.verificationFlag === "MISMATCH" || (r.verificationFlag === "NEEDS_REVIEW" && r.state === "FAILED") ? "UNDER_REVIEW" : r.state === "SUCCEEDED" || r.state === "FAILED" ? r.state : "PENDING",
    }));
}

export async function getCustomerOrderView(orderId: string, viewer: OrderViewer): Promise<CustomerOrderView> {
  if (!(await canViewOrder(orderId, viewer))) throw notFound();
  const order = await db().order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      lines: true,
      attempts: { orderBy: { createdAt: "desc" }, take: 1 },
      refundCases: { include: { refunds: true } },
      fulfillment: true,
      operations: { where: { type: "CANCELLATION_REQUEST" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const lines = order.lines.filter((l) => l.snapshotRevision === order.snapshotRevision);
  const request = order.operations[0] ?? null;
  const beforeHandover = order.state === "AWAITING_PAYMENT" || order.state === "PAID" || order.state === "PREPARING" || order.state === "ON_HOLD";
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
    recipient: {
      name: order.recipientName,
      phone: order.recipientPhone,
      ...(order.recipientEmail ? { email: order.recipientEmail } : {}),
      ...(order.landmark ? { landmark: order.landmark } : {}),
      ...(order.instructions ? { instructions: order.instructions } : {}),
    },
    destination: { lat: Number(order.destinationLat), lng: Number(order.destinationLng) },
    createdAt: order.createdAt.toISOString(),
    refunds: customerRefunds(order.refundCases.flatMap((c) => c.refunds)),
    isDemo: order.dataOrigin !== "VERIFIED",
    holdReason: order.holdReason,
    paidAt: order.paidAt?.toISOString() ?? null,
    latestAttempt: order.attempts[0] ? { id: order.attempts[0].id, state: order.attempts[0].state } : null,
    fulfillment: order.fulfillment
      ? {
          state: order.fulfillment.state,
          deliveredAt: order.fulfillment.deliveredAt?.toISOString() ?? null,
          promisedWindowStart: order.fulfillment.promisedWindowStart?.toISOString() ?? null,
          promisedWindowEnd: order.fulfillment.promisedWindowEnd?.toISOString() ?? null,
        }
      : null,
    cancellationRequest: request ? { operationId: request.id, state: request.state, outcome: request.outcome } : null,
    canRequestCancellation: beforeHandover && request?.state !== "PENDING",
    canCreatePrivateLink: order.paidAt !== null && viewer.guestSession?.id === order.guestSessionId,
  };
}
