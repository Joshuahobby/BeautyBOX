import Link from "next/link";
import { db } from "@/server/db";
import { Notice } from "@/components/ui/Notice";
import { operatingContext, publicationBlocks } from "@/modules/settings/settings";
import { can } from "@/modules/staff/capabilities";
import { staffPageAccess } from "@/server/staff-page";
import styles from "@/components/staff/Staff.module.css";

export const dynamic = "force-dynamic";

const BLOCK_TEXT: Record<string, string> = {
  CHECKOUT_DISABLED: "Checkout is paused.",
  TARIFF_NOT_APPROVED: "Delivery tariff is not approved (demo values).",
  ORIGIN_NOT_APPROVED: "Dispatch pin is not approved (synthetic pin).",
  ORIGIN_INACTIVE: "Dispatch location is inactive.",
  SETTINGS_NOT_VERIFIED: "Operating settings are demo values.",
  POLICIES_NOT_APPROVED: "Delivery, returns, terms and privacy policies are drafts.",
  SUPPORT_CONTACT_MISSING: "Support contact is not set.",
  DELIVERY_PROMISE_MISSING: "Delivery window promise is not set.",
  LIVE_PAYMENTS_DISABLED: "Live payments are off.",
  PAYMENT_ADAPTER_NOT_LIVE: "Payments use the simulator, not pawaPay.",
  ROUTING_ADAPTER_NOT_LIVE: "Delivery distances use the simulator, not live routing.",
  CUSTOMER_MESSAGES_DISABLED: "Order receipts are paused. Turn on Customer messages in Staff settings.",
  EMAIL_ADAPTER_NOT_LIVE: "Order e-mails are not sent (EMAIL_PROVIDER is not resend).",
};

// Operational overview: work needing attention first (A01 default), plus the release
// blocks that keep public paid checkout closed.
export default async function StaffOverviewPage() {
  const access = await staffPageAccess("orders.read");
  if (access.kind === "NONE") return null;
  if (access.kind === "FORBIDDEN") return <Notice tone="warning" title="Your role does not include orders." />;
  const finance = can(access.staff.role, "payments.read");
  const [toPrepare, onHold, unresolved, flagged, openCases, cancelRequests, smsProblems, ctx] = await Promise.all([
    db().order.count({ where: { state: "PAID" } }),
    db().order.count({ where: { state: "ON_HOLD" } }),
    db().paymentAttempt.count({ where: { state: { in: ["CREATED", "PENDING"] } } }),
    db().paymentAttempt.count({ where: { verificationFlag: { not: null } } }),
    db().refundCase.count({ where: { state: "OPEN" } }),
    db().operation.count({ where: { type: "CANCELLATION_REQUEST", state: "PENDING" } }),
    db().notification.count({ where: { state: { in: ["FAILED", "UNKNOWN"] } } }),
    operatingContext(),
  ]);
  const blocks = publicationBlocks(ctx);
  return (
    <div className={styles.stack}>
      <h1 className="page-title">Overview</h1>
      <div className={styles.cards}>
        <Link href="/staff/orders?state=PAID" className={styles.card}>
          <span className="label-text muted">Paid orders to prepare</span>
          <span className={styles.metric}>{toPrepare}</span>
        </Link>
        <Link href="/staff/orders?attention=cancellation" className={styles.card}>
          <span className="label-text muted">Cancellation requests to decide</span>
          <span className={styles.metric}>{cancelRequests}</span>
        </Link>
        <Link href="/staff/orders?state=ON_HOLD" className={styles.card}>
          <span className="label-text muted">Orders on hold</span>
          <span className={styles.metric}>{onHold}</span>
        </Link>
        {finance ? (
          <>
            <Link href="/staff/finance" className={styles.card}>
              <span className="label-text muted">Payments still being checked</span>
              <span className={styles.metric}>{unresolved}</span>
            </Link>
            <Link href="/staff/finance" className={styles.card}>
              <span className="label-text muted">Payment exceptions</span>
              <span className={styles.metric}>{flagged}</span>
            </Link>
            <Link href="/staff/finance" className={styles.card}>
              <span className="label-text muted">Open refund cases</span>
              <span className={styles.metric}>{openCases}</span>
            </Link>
          </>
        ) : null}
        <div className={styles.card}>
          <span className="label-text muted">Customer message not confirmed sent</span>
          <span className={styles.metric}>{smsProblems}</span>
        </div>
      </div>
      {blocks.length > 0 ? (
        <Notice tone="warning" title="Public paid checkout stays closed until these are resolved">
          <ul className="u-m-0 u-indent">
            {blocks.map((b) => (
              <li key={b}>{BLOCK_TEXT[b] ?? b}</li>
            ))}
          </ul>
        </Notice>
      ) : (
        <Notice tone="success" title="No release blocks recorded." />
      )}
    </div>
  );
}
