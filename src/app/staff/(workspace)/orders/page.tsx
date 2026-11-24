import Link from "next/link";
import { listStaffOrders } from "@/modules/orders/staff-views";
import { formatKigaliDateTime } from "@/messages";
import { formatRwf } from "@/modules/shared/money";
import {
  humanize,
  ORDER_STATE_LABEL as STATE_LABEL,
} from "@/components/staff/labels";
import { Notice } from "@/components/ui/Notice";
import { staffPageAccess } from "@/server/staff-page";
import styles from "@/components/staff/Staff.module.css";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | undefined>>;

const STATES = [
  "PAID",
  "PREPARING",
  "ON_HOLD",
  "DISPATCHED",
  "AWAITING_PAYMENT",
  "DELIVERED",
  "CANCELLED",
] as const;
type OrderStateFilter = (typeof STATES)[number];

// A01 order queue: work needing action first. Payment and fulfilment are separate facts;
// contact details are not listed in bulk (CC-11).
export default async function StaffOrdersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await staffPageAccess("orders.read");
  if (access.kind === "NONE") return null;
  if (access.kind === "FORBIDDEN")
    return <Notice tone="warning" title="Your role does not include orders." />;
  const sp = await searchParams;
  const cancellationOnly = sp.attention === "cancellation";
  const state = STATES.includes(sp.state as OrderStateFilter)
    ? (sp.state as OrderStateFilter)
    : undefined;
  const reference = sp.reference?.trim().slice(0, 20) || undefined;
  const page = await listStaffOrders({
    state,
    reference,
    cancellationRequested: cancellationOnly || undefined,
    cursor: sp.cursor ?? null,
    limit: 25,
  });
  return (
    <div className={styles.stack}>
      <h1 className="page-title">
        {cancellationOnly ? "Orders with a cancellation request" : "Orders"}
      </h1>
      {cancellationOnly ? (
        <p>
          <Link href="/staff/orders">Show all orders</Link>
        </p>
      ) : null}
      <form className={styles.row} action="/staff/orders" role="search">
        <label htmlFor="order-state" className="label-text">
          Status
        </label>
        <select
          id="order-state"
          name="state"
          defaultValue={state ?? ""}
          className={styles.selectCompact}
        >
          <option value="">All</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {STATE_LABEL[s]}
            </option>
          ))}
        </select>
        <label htmlFor="order-ref" className="label-text">
          Reference
        </label>
        <input
          id="order-ref"
          name="reference"
          defaultValue={reference}
          placeholder="BB-"
          className={`${styles.filterInput} ${styles.filterInputNarrow}`}
        />
        <button type="submit" className={styles.filterButton}>
          Filter
        </button>
      </form>
      <ul className={styles.mobileOrderList} aria-label="Order cards">
        {page.items.length === 0 ? (
          <li>No orders match.</li>
        ) : (
          page.items.map((o) => (
            <li key={o.id}>
              <Link href={`/staff/orders/${o.id}`}>
                <strong>{o.reference}</strong>
              </Link>
              <p className="label-text muted">
                {formatKigaliDateTime(o.createdAt)}
              </p>
              <dl>
                <dt>Order</dt>
                <dd>{STATE_LABEL[o.state] ?? o.state}</dd>
                <dt>Payment</dt>
                <dd>{humanize(o.paymentState)}</dd>
                <dt>Delivery</dt>
                <dd>{o.deliveryState ? humanize(o.deliveryState) : "—"}</dd>
                <dt>Items</dt>
                <dd>{o.itemCount}</dd>
                <dt>Total</dt>
                <dd>
                  <strong>{formatRwf(o.totalRwf)}</strong>
                </dd>
              </dl>
              {orderFlags(o).length ? (
                <p className="label-text">{orderFlags(o).join(" · ")}</p>
              ) : null}
            </li>
          ))
        )}
      </ul>
      <div
        className={styles.tableRegion + " " + styles.orderTable}
        role="region"
        aria-label="Orders"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Placed</th>
              <th scope="col">Order</th>
              <th scope="col">Payment</th>
              <th scope="col">Delivery</th>
              <th scope="col" className={styles.num}>
                Items
              </th>
              <th scope="col" className={styles.num}>
                Total
              </th>
              <th scope="col">Attention</th>
            </tr>
          </thead>
          <tbody>
            {page.items.length === 0 ? (
              <tr>
                <td colSpan={8}>No orders match.</td>
              </tr>
            ) : (
              page.items.map((o) => {
                const flags = orderFlags(o);
                return (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/staff/orders/${o.id}`}>
                        <code>{o.reference}</code>
                      </Link>
                    </td>
                    <td>{formatKigaliDateTime(o.createdAt)}</td>
                    <td>{STATE_LABEL[o.state] ?? o.state}</td>
                    <td>{humanize(o.paymentState)}</td>
                    <td>{o.deliveryState ? humanize(o.deliveryState) : "—"}</td>
                    <td className={styles.num}>{o.itemCount}</td>
                    <td className={styles.num}>{formatRwf(o.totalRwf)}</td>
                    <td>
                      {flags.map((f) => (
                        <span
                          key={f}
                          className={`${styles.status} ${styles.statusWarn} u-mr-4px`}
                        >
                          {f}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {page.nextCursor ? (
        <p>
          <Link
            href={`/staff/orders?${new URLSearchParams({ ...(state ? { state } : {}), ...(reference ? { reference } : {}), ...(cancellationOnly ? { attention: "cancellation" } : {}), cursor: page.nextCursor })}`}
          >
            Next page
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function orderFlags(
  o: Awaited<ReturnType<typeof listStaffOrders>>["items"][number],
) {
  return [
    o.isDemo ? "Demo" : null,
    o.cancellationRequested ? "Cancellation requested" : null,
    o.attentionFlag ? `Payment ${humanize(o.attentionFlag)}` : null,
    o.holdReason ? `Hold: ${humanize(o.holdReason)}` : null,
    o.smsProblem ? "Message problem" : null,
  ].filter((flag): flag is string => flag !== null);
}
