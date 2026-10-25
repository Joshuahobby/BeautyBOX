import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { now } from "@/modules/shared/clock";

// Reconciliation sweep (I13 "reconciliation sweep"): read-only integrity checks across
// money, stock and durable jobs. Each check returns a count and up to five record ids
// (no personal data). Any non-zero count is a defect or a stuck state that an operator
// must investigate; the sweep never repairs anything by itself.

export type SweepCheck = { code: string; description: string; count: number; sample: string[] };

const ACTIVE_JOB = Prisma.sql`('READY','RETRY_DUE','LEASED')`;

const CHECKS: { code: string; description: string; sql: Prisma.Sql }[] = [
  {
    code: "LEDGER_DRIFT",
    description: "Stock lot quantities differ from the sum of their ledger movements.",
    sql: Prisma.sql`SELECT l.id::text AS id FROM commerce.inventory_lots l
      LEFT JOIN (SELECT lot_id, SUM(on_hand_delta) oh, SUM(reserved_delta) rs, SUM(committed_delta) cm FROM commerce.inventory_movements GROUP BY lot_id) m ON m.lot_id = l.id
      WHERE l.quantity_on_hand <> COALESCE(m.oh,0) OR l.reserved_qty <> COALESCE(m.rs,0) OR l.committed_qty <> COALESCE(m.cm,0)`,
  },
  {
    code: "RESERVED_DRIFT",
    description: "Reserved stock on a lot differs from its active reservations.",
    sql: Prisma.sql`SELECT l.id::text AS id FROM commerce.inventory_lots l
      LEFT JOIN (SELECT rl.lot_id, SUM(rl.quantity) q FROM commerce.reservation_lines rl JOIN commerce.reservations r ON r.id = rl.reservation_id WHERE r.state = 'ACTIVE' GROUP BY rl.lot_id) a ON a.lot_id = l.id
      WHERE l.reserved_qty <> COALESCE(a.q,0)`,
  },
  {
    code: "COMMITTED_DRIFT",
    description: "Committed stock on a lot differs from its committed allocations.",
    sql: Prisma.sql`SELECT l.id::text AS id FROM commerce.inventory_lots l
      LEFT JOIN (SELECT lot_id, SUM(quantity) q FROM commerce.allocations WHERE state = 'COMMITTED' GROUP BY lot_id) a ON a.lot_id = l.id
      WHERE l.committed_qty <> COALESCE(a.q,0)`,
  },
  {
    code: "PAID_WITHOUT_RECEIPT",
    description: "Order is fulfilled as paid, or shows money collected, without a matching verified receipt.",
    sql: Prisma.sql`SELECT o.id::text AS id FROM commerce.orders o
      WHERE (o.state IN ('PAID','PREPARING','DISPATCHED','DELIVERED')
             AND NOT EXISTS (SELECT 1 FROM commerce.payment_receipts r WHERE r.order_id = o.id AND r.disposition = 'APPLIED'))
         OR (o.payment_state IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
             AND NOT EXISTS (SELECT 1 FROM commerce.payment_receipts r WHERE r.order_id = o.id AND r.disposition IN ('APPLIED','AFTER_CANCELLATION','REVIEW')))`,
  },
  {
    code: "RECEIPT_NOT_REFLECTED",
    description: "An applied verified receipt exists but the order still shows unpaid/pending.",
    sql: Prisma.sql`SELECT o.id::text AS id FROM commerce.orders o
      WHERE o.payment_state IN ('UNPAID','PENDING')
        AND EXISTS (SELECT 1 FROM commerce.payment_receipts r WHERE r.order_id = o.id AND r.disposition = 'APPLIED')`,
  },
  {
    code: "COLLECTION_WITHOUT_REFUND_PATH",
    description: "Money collected for a cancelled order, an overpayment or a review receipt has no open refund case, no refund in progress or under finance review, and is not fully refunded.",
    sql: Prisma.sql`SELECT r.id::text AS id FROM commerce.payment_receipts r JOIN commerce.orders o ON o.id = r.order_id
      WHERE (o.state = 'CANCELLED' OR r.disposition <> 'APPLIED')
        AND r.verified_amount_rwf > COALESCE((SELECT SUM(f.amount_rwf) FROM commerce.refunds f WHERE f.receipt_id = r.id AND f.state = 'SUCCEEDED'), 0)
        AND NOT EXISTS (SELECT 1 FROM commerce.refund_cases c WHERE c.receipt_id = r.id AND c.state = 'OPEN')
        AND NOT EXISTS (SELECT 1 FROM commerce.refunds f WHERE f.receipt_id = r.id
                          AND (f.state IN ('REQUESTED','APPROVED','QUEUED','SUBMITTED','PENDING') OR (f.state = 'FAILED' AND f.verification_flag = 'NEEDS_REVIEW')))`,
  },
  {
    code: "PAYMENT_STATE_MISMATCH",
    description: "Order payment state disagrees with its verified receipts and confirmed refunds.",
    sql: Prisma.sql`SELECT o.id::text AS id FROM commerce.orders o
      JOIN LATERAL (SELECT COALESCE(SUM(r.verified_amount_rwf),0) collected FROM commerce.payment_receipts r WHERE r.order_id = o.id AND r.disposition IN ('APPLIED','AFTER_CANCELLATION','REVIEW')) c ON true
      JOIN LATERAL (SELECT COALESCE(SUM(f.amount_rwf),0) refunded FROM commerce.refunds f JOIN commerce.payment_receipts r ON r.id = f.receipt_id WHERE r.order_id = o.id AND r.disposition IN ('APPLIED','AFTER_CANCELLATION','REVIEW') AND f.state = 'SUCCEEDED') f ON true
      WHERE c.collected > 0 AND o.payment_state <> 'EXCEPTION' AND (
        (o.payment_state = 'REFUNDED' AND f.refunded < c.collected) OR
        (o.payment_state = 'PARTIALLY_REFUNDED' AND (f.refunded = 0 OR f.refunded >= c.collected)) OR
        (o.payment_state = 'PAID' AND f.refunded > 0))`,
  },
  {
    code: "UNRESOLVED_PAYMENT_WITHOUT_CHECK",
    description: "An unresolved deposit has no active status-check job, so it would never be reconciled.",
    sql: Prisma.sql`SELECT a.id::text AS id FROM commerce.payment_attempts a
      WHERE a.state IN ('CREATED','PENDING')
        AND NOT EXISTS (SELECT 1 FROM commerce.outbox_jobs j WHERE j.unique_intent_key = 'deposit-check:' || a.provider_deposit_id::text AND j.state IN ${ACTIVE_JOB})`,
  },
  {
    code: "REFUND_WITHOUT_ACTIVE_JOB",
    description: "An approved refund is queued, submitted or pending with no active submit/check job, so it would never finish.",
    sql: Prisma.sql`SELECT f.id::text AS id FROM commerce.refunds f
      WHERE f.state IN ('QUEUED','SUBMITTED','PENDING') AND f.provider_refund_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM commerce.outbox_jobs j WHERE j.unique_intent_key IN ('refund-submit:' || f.provider_refund_id::text, 'refund-check:' || f.provider_refund_id::text) AND j.state IN ${ACTIVE_JOB})`,
  },
  {
    code: "NOTIFICATION_WITHOUT_JOB",
    description: "A pending customer message has no active send job.",
    sql: Prisma.sql`SELECT n.id::text AS id FROM commerce.notifications n
      WHERE n.state = 'PENDING' AND NOT EXISTS (SELECT 1 FROM commerce.outbox_jobs j WHERE j.unique_intent_key = 'notify:' || n.id::text AND j.state IN ${ACTIVE_JOB})`,
  },
  {
    code: "RESERVATION_OVERDUE",
    description: "A reservation is still active more than 10 minutes after it expired (expiry job not running).",
    sql: Prisma.sql`SELECT r.id::text AS id FROM commerce.reservations r WHERE r.state = 'ACTIVE' AND r.expires_at < ${new Date(0)}::timestamptz`,
  },
  {
    code: "OBLIGATION_FOR_UNSOLD_GOODS",
    description: "A supplier obligation is still open although its allocation was released (nothing was sold).",
    sql: Prisma.sql`SELECT o.id::text AS id FROM commerce.supplier_obligations o JOIN commerce.allocations a ON a.id = o.allocation_id
      WHERE a.state = 'RELEASED' AND o.settlement_state::text IN ('OPEN','UNVALUED')`,
  },
  {
    code: "SHIPPED_WITHOUT_DISPATCH",
    description: "Stock was shipped for an order that is not dispatched or delivered.",
    sql: Prisma.sql`SELECT DISTINCT o.id::text AS id FROM commerce.allocations a JOIN commerce.order_lines l ON l.id = a.order_line_id JOIN commerce.orders o ON o.id = l.order_id
      WHERE a.state = 'SHIPPED' AND o.state NOT IN ('DISPATCHED','DELIVERED')`,
  },
];

export async function reconciliationSweep(): Promise<{ generatedAt: string; issues: number; checks: SweepCheck[] }> {
  const at = now();
  const overdueBefore = new Date(at.getTime() - 10 * 60 * 1000);
  const checks: SweepCheck[] = [];
  for (const check of CHECKS) {
    const sql = check.code === "RESERVATION_OVERDUE"
      ? Prisma.sql`SELECT r.id::text AS id FROM commerce.reservations r WHERE r.state = 'ACTIVE' AND r.expires_at < ${overdueBefore}`
      : check.sql;
    const rows = await db().$queryRaw<{ id: string }[]>`SELECT id FROM (${sql}) AS c ORDER BY id LIMIT 1000`;
    checks.push({ code: check.code, description: check.description, count: rows.length, sample: rows.slice(0, 5).map((r) => r.id) });
  }
  return { generatedAt: at.toISOString(), issues: checks.reduce((n, c) => n + c.count, 0), checks };
}
