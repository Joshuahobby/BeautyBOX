import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { Notice } from "@/components/ui/Notice";
import { humanize } from "@/components/staff/labels";
import { formatKigaliDateTime } from "@/messages";
import { countPaymentExceptions, listPaymentExceptions } from "@/modules/payments/reconcile";
import { formatRwf } from "@/modules/shared/money";
import { staffPageAccess } from "@/server/staff-page";
import styles from "@/components/staff/Staff.module.css";

export const dynamic = "force-dynamic";

const PAGE = 25;

const EXCEPTION_TEXT: Record<string, string> = {
  MISMATCH: "Amount or currency did not match the order",
  NEEDS_REVIEW: "Needs review (long unresolved or not found)",
  UNKNOWN: "Outcome unknown",
  DELAYED_UNRESOLVED: "Still being checked (over 10 minutes)",
};

function age(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} d`;
}

type SearchParams = Promise<Record<string, string | undefined>>;
const uuidOrNull = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/** Link to the next page of one queue, keeping the other queues' positions. */
function nextHref(sp: Record<string, string | undefined>, param: string, cursor: string) {
  const q = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
  q.set(param, cursor);
  return `/staff/finance?${q}`;
}

// A04 finance workspace: unresolved and flagged deposits, refunds waiting for a decision or
// for the provider, refunds confirmed for a different amount, and open refund cases with
// nothing requested yet. Each queue pages explicitly and shows its true size (RF-29).
// Actions happen on the order page, where the full payment and refund context is shown.
export default async function FinancePage({ searchParams }: { searchParams: SearchParams }) {
  const access = await staffPageAccess("payments.read");
  if (access.kind === "NONE") return null;
  if (access.kind === "FORBIDDEN") return <Notice tone="warning" title="Your role does not include payments and refunds." />;
  const sp = await searchParams;

  // A failed refund stays listed only while its case is still open (it needs a new request).
  const refundsWhere: Prisma.RefundWhereInput = {
    OR: [{ state: { in: ["REQUESTED", "APPROVED", "QUEUED", "SUBMITTED", "PENDING"] } }, { state: "FAILED", refundCase: { state: "OPEN" } }],
  };
  const mismatchWhere: Prisma.RefundWhereInput = { verificationFlag: "MISMATCH" };
  const reviewWhere: Prisma.RefundWhereInput = { verificationFlag: "NEEDS_REVIEW" };
  const casesWhere: Prisma.RefundCaseWhereInput = { state: "OPEN", refunds: { none: {} } };
  const include = { refundCase: { include: { order: { select: { id: true, reference: true } } } } } as const;
  const page = <T,>(rows: T[]) => ({ items: rows.slice(0, PAGE), more: rows.length > PAGE });

  const exceptions = await listPaymentExceptions({ limit: PAGE, cursor: uuidOrNull(sp.ex) });
  const exceptionTotal = await countPaymentExceptions();
  const rfCursor = uuidOrNull(sp.rf);
  const refunds = page(await db().refund.findMany({ where: refundsWhere, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: PAGE + 1, ...(rfCursor ? { cursor: { id: rfCursor }, skip: 1 } : {}), include }));
  const refundTotal = await db().refund.count({ where: refundsWhere });
  const mismatches = await db().refund.findMany({ where: mismatchWhere, orderBy: { updatedAt: "desc" }, take: PAGE, include });
  const mismatchTotal = await db().refund.count({ where: mismatchWhere });
  // Keyset paging: a review resolved meanwhile (the cursor row no longer matches) must not
  // make the next page skip one.
  const rvCursor = uuidOrNull(sp.rv);
  const rvAfter = rvCursor ? await db().refund.findUnique({ where: { id: rvCursor }, select: { id: true, createdAt: true } }) : null;
  const reviews = page(
    await db().refund.findMany({
      where: rvAfter ? { AND: [reviewWhere, { OR: [{ createdAt: { gt: rvAfter.createdAt } }, { createdAt: rvAfter.createdAt, id: { gt: rvAfter.id } }] }] } : reviewWhere,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: PAGE + 1,
      include,
    }),
  );
  const reviewTotal = await db().refund.count({ where: reviewWhere });
  const csCursor = uuidOrNull(sp.cs);
  const cases = page(
    await db().refundCase.findMany({
      where: casesWhere,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: PAGE + 1,
      ...(csCursor ? { cursor: { id: csCursor }, skip: 1 } : {}),
      include: { order: { select: { id: true, reference: true } } },
    }),
  );
  const caseTotal = await db().refundCase.count({ where: casesWhere });

  return (
    <div className={styles.stack}>
      <h1 className="page-title">Payments &amp; refunds</h1>
      <p className="muted">A refund is shown as complete only after the provider confirms it. Open the order to act.</p>

      <section className={styles.stack} aria-labelledby="exceptions-title">
        <h2 id="exceptions-title" className="section-title">
          Payment exceptions ({exceptionTotal})
        </h2>
        <div className={styles.tableRegion} role="region" aria-label="Payment exceptions" tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Issue</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles.num}>
                  Amount
                </th>
                <th scope="col">Age</th>
                <th scope="col">Next check</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.items.length === 0 ? (
                <tr>
                  <td colSpan={6}>Nothing needs attention.</td>
                </tr>
              ) : (
                exceptions.items.map((e) => (
                  <tr key={e.attemptId}>
                    <td>
                      <Link href={`/staff/orders/${e.orderId}`}>
                        <code>{e.orderReference}</code>
                      </Link>
                    </td>
                    <td>{EXCEPTION_TEXT[e.code] ?? humanize(e.code)}</td>
                    <td>{humanize(e.attemptState)}</td>
                    <td className={styles.num}>{formatRwf(e.amountRwf)}</td>
                    <td>{age(e.ageSeconds)}</td>
                    <td>{e.nextCheckAt ? formatKigaliDateTime(e.nextCheckAt) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {exceptions.nextCursor ? <Link href={nextHref(sp, "ex", exceptions.nextCursor)}>More payment exceptions</Link> : null}
      </section>

      <section className={styles.stack} aria-labelledby="refunds-title">
        <h2 id="refunds-title" className="section-title">
          Refunds in progress ({refundTotal})
        </h2>
        <div className={styles.tableRegion} role="region" aria-label="Refunds in progress" tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Reason</th>
                <th scope="col" className={styles.num}>
                  Amount
                </th>
                <th scope="col">Status</th>
                <th scope="col">Requested</th>
              </tr>
            </thead>
            <tbody>
              {refunds.items.length === 0 ? (
                <tr>
                  <td colSpan={5}>No refunds in progress.</td>
                </tr>
              ) : (
                refunds.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/staff/orders/${r.refundCase.order.id}`}>
                        <code>{r.refundCase.order.reference}</code>
                      </Link>
                    </td>
                    <td>{r.reason}</td>
                    <td className={styles.num}>{formatRwf(Number(r.amountRwf))}</td>
                    <td>
                      {r.state === "REQUESTED" ? <span className={`${styles.status} ${styles.statusWarn}`}>Awaiting decision</span> : humanize(r.state)}
                      {r.state === "FAILED" ? (
                        <span className={`${styles.status} ${styles.statusWarn} u-ml-8px`}>
                          {r.verificationFlag === "NEEDS_REVIEW" ? "Provider records differ: check before refunding again" : "Provider failed: request again"}
                        </span>
                      ) : null}
                    </td>
                    <td>{formatKigaliDateTime(r.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {refunds.more ? <Link href={nextHref(sp, "rf", refunds.items[refunds.items.length - 1]!.id)}>More refunds</Link> : null}
      </section>

      {mismatchTotal > 0 ? (
        <section className={styles.stack} aria-labelledby="mismatch-title">
          <h2 id="mismatch-title" className="section-title">
            Refunds confirmed for a different amount ({mismatchTotal})
          </h2>
          <p className="muted">The provider completed these refunds for an amount other than the one approved. Reconcile them with the provider; the customer was not sent a confirmed amount.</p>
          <ul className="u-m-0 u-indent">
            {mismatches.map((r) => (
              <li key={r.id}>
                <Link href={`/staff/orders/${r.refundCase.order.id}`}>
                  <code>{r.refundCase.order.reference}</code>
                </Link>{" "}
                · approved {formatRwf(Number(r.amountRwf))} · provider reported {r.providerAmountRwf === null ? "a different amount" : formatRwf(Number(r.providerAmountRwf))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {reviewTotal > 0 ? (
        <section className={styles.stack} aria-labelledby="review-title">
          <h2 id="review-title" className="section-title">
            Refunds where the provider&apos;s records differ ({reviewTotal})
          </h2>
          <p className="muted">
            The provider refused these refunds although they were within the amount collected, reported another refund in progress that this app did not send, or reported one as completed after it was recorded as failed. Their amounts stay reserved. Find the payment in the provider&apos;s dashboard, then close each review on the order.
          </p>
          <ul className="u-m-0 u-indent">
            {reviews.items.map((r) => (
              <li key={r.id}>
                <Link href={`/staff/orders/${r.refundCase.order.id}`}>
                  <code>{r.refundCase.order.reference}</code>
                </Link>{" "}
                · {formatRwf(Number(r.amountRwf))} · {humanize(r.state)}
                {r.state === "FAILED" && r.failureCode ? ` · provider code ${r.failureCode}` : ""}
              </li>
            ))}
          </ul>
          {reviews.more ? <Link href={nextHref(sp, "rv", reviews.items[reviews.items.length - 1]!.id)}>More refunds to review</Link> : null}
        </section>
      ) : null}

      <section className={styles.stack} aria-labelledby="cases-title">
        <h2 id="cases-title" className="section-title">
          Refund cases without a refund request ({caseTotal})
        </h2>
        {cases.items.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <ul className="u-m-0 u-indent">
            {cases.items.map((c) => (
              <li key={c.id}>
                <Link href={`/staff/orders/${c.order.id}`}>
                  <code>{c.order.reference}</code>
                </Link>{" "}
                · {humanize(c.source)} · {c.reason} · opened {formatKigaliDateTime(c.createdAt)}
              </li>
            ))}
          </ul>
        )}
        {cases.more ? <Link href={nextHref(sp, "cs", cases.items[cases.items.length - 1]!.id)}>More refund cases</Link> : null}
      </section>
    </div>
  );
}
