import "server-only";
import { db } from "@/server/db";
import { now } from "@/modules/shared/clock";
import { UNRESOLVED_REVIEW_AFTER_SECONDS } from "@/modules/payments/handlers";

// Operational summary for monitoring and alerting (I13). Counts and ages only: no order
// references, phone numbers, amounts or provider payloads, so it is safe to send to an
// external uptime/alerting service. A monitor should alert whenever `alerts` is not empty.

export const JOB_BACKLOG_ALERT_SECONDS = 5 * 60;
export const REFUND_STUCK_AFTER_SECONDS = 24 * 60 * 60;
/** Flags and failures stay on their records; they alert for this long after they happen. */
export const RECENT_ALERT_SECONDS = 7 * 24 * 60 * 60;

export type OpsAlert =
  | "JOB_BACKLOG"
  | "JOBS_NEED_REVIEW"
  | "STALE_JOB_LEASES"
  | "PAYMENTS_UNRESOLVED_LONG"
  | "PAYMENT_EXCEPTIONS"
  | "REFUNDS_FAILED"
  | "REFUND_AMOUNT_MISMATCH"
  | "REFUNDS_NEED_REVIEW"
  | "REFUNDS_STUCK"
  | "STOCK_LEDGER_DRIFT"
  | "REFUNDS_AWAITING_DECISION"
  | "SMS_NOT_DELIVERED"
  | "CANCELLATION_REQUESTS_WAITING";

export async function opsSummary() {
  const at = now();
  const client = db();
  // Sequential on purpose: small counts, one pooled connection, no burst on the database.
  const dueJobs = await client.outboxJob.count({ where: { state: { in: ["READY", "RETRY_DUE"] }, dueAt: { lte: at } } });
  const oldestDue = await client.outboxJob.findFirst({ where: { state: { in: ["READY", "RETRY_DUE"] }, dueAt: { lte: at } }, orderBy: { dueAt: "asc" }, select: { dueAt: true } });
  const recentCutoff = new Date(at.getTime() - RECENT_ALERT_SECONDS * 1000);
  const needsReview = await client.outboxJob.count({ where: { state: "NEEDS_REVIEW", updatedAt: { gte: recentCutoff } } });
  const staleLeases = await client.outboxJob.count({ where: { state: "LEASED", leaseUntil: { lt: at } } });
  const unresolved = await client.paymentAttempt.count({ where: { state: { in: ["CREATED", "PENDING"] } } });
  const unresolvedLong = await client.paymentAttempt.count({
    where: { state: { in: ["CREATED", "PENDING"] }, createdAt: { lt: new Date(at.getTime() - UNRESOLVED_REVIEW_AFTER_SECONDS * 1000) } },
  });
  const recent = new Date(at.getTime() - RECENT_ALERT_SECONDS * 1000);
  const flagged = await client.paymentAttempt.count({
    where: { verificationFlag: { not: null }, OR: [{ state: { in: ["CREATED", "PENDING"] } }, { updatedAt: { gte: recent } }] },
  });
  const refundsAwaiting = await client.refund.count({ where: { state: "REQUESTED" } });
  const refundsInFlight = await client.refund.count({ where: { state: { in: ["APPROVED", "QUEUED", "SUBMITTED", "PENDING"] } } });
  const refundsFailed = await client.refund.count({ where: { state: "FAILED", updatedAt: { gte: recent } } });
  const refundMismatches = await client.refund.count({ where: { verificationFlag: "MISMATCH", updatedAt: { gte: recent } } });
  // Unlike the other flags, a review is closed by finance (resolveRefundReview), so it alerts until then.
  const refundReviews = await client.refund.count({ where: { verificationFlag: "NEEDS_REVIEW" } });
  const smsFailed = await client.notification.count({ where: { state: "FAILED", updatedAt: { gte: recent } } });
  const smsUnknown = await client.notification.count({ where: { state: "UNKNOWN", updatedAt: { gte: recent } } });
  // Money stuck with the provider: a refund approved more than a day ago and not finished.
  const refundsStuck = await client.refund.count({ where: { state: { in: ["QUEUED", "SUBMITTED", "PENDING"] }, approvedAt: { lt: new Date(at.getTime() - REFUND_STUCK_AFTER_SECONDS * 1000) } } });
  // Stock invariant: lot quantities must equal their ledger (spec "stock invariant violations").
  const ledgerDrift = Number(
    (
      await client.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM commerce.inventory_lots l
          LEFT JOIN (SELECT lot_id, SUM(on_hand_delta) oh, SUM(reserved_delta) rs, SUM(committed_delta) cm FROM commerce.inventory_movements GROUP BY lot_id) m ON m.lot_id = l.id
         WHERE l.quantity_on_hand <> COALESCE(m.oh,0) OR l.reserved_qty <> COALESCE(m.rs,0) OR l.committed_qty <> COALESCE(m.cm,0)`
    )[0]!.n,
  );
  const cancellationRequests = await client.operation.count({ where: { type: "CANCELLATION_REQUEST", state: "PENDING" } });
  const oldestDueSeconds = oldestDue ? Math.max(0, Math.floor((at.getTime() - oldestDue.dueAt.getTime()) / 1000)) : 0;

  const alerts: OpsAlert[] = [];
  if (oldestDueSeconds > JOB_BACKLOG_ALERT_SECONDS) alerts.push("JOB_BACKLOG");
  if (needsReview > 0) alerts.push("JOBS_NEED_REVIEW");
  if (staleLeases > 0) alerts.push("STALE_JOB_LEASES");
  if (unresolvedLong > 0) alerts.push("PAYMENTS_UNRESOLVED_LONG");
  if (flagged > 0) alerts.push("PAYMENT_EXCEPTIONS");
  if (refundsFailed > 0) alerts.push("REFUNDS_FAILED");
  if (refundMismatches > 0) alerts.push("REFUND_AMOUNT_MISMATCH");
  if (refundReviews > 0) alerts.push("REFUNDS_NEED_REVIEW");
  if (refundsStuck > 0) alerts.push("REFUNDS_STUCK");
  if (ledgerDrift > 0) alerts.push("STOCK_LEDGER_DRIFT");
  if (refundsAwaiting > 0) alerts.push("REFUNDS_AWAITING_DECISION");
  if (smsFailed + smsUnknown > 0) alerts.push("SMS_NOT_DELIVERED");
  if (cancellationRequests > 0) alerts.push("CANCELLATION_REQUESTS_WAITING");

  return {
    generatedAt: at.toISOString(),
    jobs: { due: dueJobs, oldestDueSeconds, needsReview, staleLeases },
    payments: { unresolved, unresolvedOverReviewAge: unresolvedLong, flagged },
    refunds: { awaitingDecision: refundsAwaiting, inFlight: refundsInFlight, stuckOverADay: refundsStuck, failed: refundsFailed, amountMismatch: refundMismatches, needsReview: refundReviews },
    stock: { ledgerDriftLots: ledgerDrift },
    notifications: { failed: smsFailed, outcomeUnknown: smsUnknown },
    operations: { cancellationRequestsWaiting: cancellationRequests },
    alerts,
  };
}
