import "server-only";
import type { Tx } from "@/server/db";
import type { RefundCaseSource } from "@/generated/prisma/client";
import { now } from "@/modules/shared/clock";

// Refund/resolution cases. Opening a case moves no money: refunds are requested,
// approved (ADMIN/FINANCE), budget-reserved and submitted separately (I10).
//
// One OPEN case per receipt, whatever triggered it (stock hold, cancellation,
// overpayment, review, staff request): a later trigger for the same money adds to that
// case instead of stacking a second one that could never close (RF-16). No case is
// opened for a receipt that has nothing left to refund.

/**
 * A refund whose amount cannot be refunded again: approved through succeeded, or failed but
 * flagged NEEDS_REVIEW (the provider's records differ, so money may have left) until finance
 * resolves the review (DR-043).
 */
export function holdsRefundBudget(r: { state: string; verificationFlag: string | null }): boolean {
  return ["APPROVED", "QUEUED", "SUBMITTED", "PENDING", "SUCCEEDED"].includes(r.state) || (r.state === "FAILED" && r.verificationFlag === "NEEDS_REVIEW");
}

/** Money still refundable from a receipt: verified amount minus succeeded and reserved refunds. */
export async function receiptRemaining(tx: Tx, receiptId: string): Promise<number> {
  const receipt = await tx.paymentReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  const refunds = await tx.refund.findMany({ where: { receiptId } });
  return Number(receipt.verifiedAmountRwf) - refunds.filter(holdsRefundBudget).reduce((n, r) => n + Number(r.amountRwf), 0);
}

export async function openRefundCase(
  tx: Tx,
  input: { orderId: string; receiptId: string | null; source: RefundCaseSource; reason: string; requestedByStaffId?: string | null },
): Promise<string | null> {
  const existing = await tx.refundCase.findFirst({
    where: input.receiptId
      ? { receiptId: input.receiptId, state: "OPEN" }
      : { orderId: input.orderId, receiptId: null, source: input.source, state: "OPEN" },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    // A staff request closes once its own refunds are final; any other trigger means the
    // customer is owed the whole collection. The case takes on that stronger purpose, so it
    // cannot close while money is still owed (DR-043 review).
    if (existing.source === "STAFF_REQUEST" && input.source !== "STAFF_REQUEST") {
      await tx.refundCase.update({ where: { id: existing.id }, data: { source: input.source, reason: `${input.reason} (was: ${existing.reason})`.slice(0, 500) } });
    }
    return existing.id;
  }
  if (input.receiptId && (await receiptRemaining(tx, input.receiptId)) <= 0) return null;
  const created = await tx.refundCase.create({
    data: {
      orderId: input.orderId,
      receiptId: input.receiptId,
      source: input.source,
      reason: input.reason,
      requestedByStaffId: input.requestedByStaffId ?? null,
      createdAt: now(),
    },
  });
  return created.id;
}

/**
 * Closes a case when its purpose is fulfilled. A case created by a staff request (a
 * discretionary, possibly partial refund) closes when all its refunds are final. Every
 * other case (cancellation, stock hold, overpayment, payment review) means the customer
 * is owed the collected money, so it stays open until the receipt is fully refunded:
 * a partial refund never silently closes it (RF-16).
 */
export async function closeCaseIfDone(tx: Tx, caseId: string): Promise<void> {
  const refundCase = await tx.refundCase.findUniqueOrThrow({ where: { id: caseId }, include: { refunds: true } });
  if (refundCase.state !== "OPEN") return;
  // A failed refund still under finance review is not final: money may have left (DR-043).
  const allFinal = refundCase.refunds.every((r) => r.state === "SUCCEEDED" || r.state === "REJECTED" || (r.state === "FAILED" && r.verificationFlag !== "NEEDS_REVIEW"));
  let done: boolean;
  if (refundCase.source === "STAFF_REQUEST") {
    done = refundCase.refunds.length > 0 && allFinal;
  } else if (refundCase.receiptId) {
    const receipt = await tx.paymentReceipt.findUniqueOrThrow({ where: { id: refundCase.receiptId } });
    const succeeded = await tx.refund.findMany({ where: { receiptId: refundCase.receiptId, state: "SUCCEEDED" } });
    done = allFinal && succeeded.reduce((n, r) => n + Number(r.amountRwf), 0) >= Number(receipt.verifiedAmountRwf);
  } else {
    done = refundCase.refunds.length > 0 && allFinal;
  }
  if (done) await tx.refundCase.update({ where: { id: caseId }, data: { state: "CLOSED", closedAt: now() } });
}
