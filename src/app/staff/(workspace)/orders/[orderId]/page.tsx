import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Notice } from "@/components/ui/Notice";
import { ActionDialog, type ActionDialogProps } from "@/components/staff/ActionDialog";
import { EXCEPTION_LABEL, humanize, ORDER_STATE_LABEL } from "@/components/staff/labels";
import { formatKigaliDateTime } from "@/messages";
import { getStaffOrder, type StaffOrderView } from "@/modules/orders/staff-views";
import { isDomainError } from "@/modules/shared/errors";
import { formatRwf } from "@/modules/shared/money";
import { can, type Capability } from "@/modules/staff/capabilities";
import { staffPageAccess } from "@/server/staff-page";
import styles from "@/components/staff/Staff.module.css";

export const dynamic = "force-dynamic";

type Cmd = Omit<ActionDialogProps, "endpoint" | "staticBody"> & { action: string; capability: Capability };

/** Commands offered for the order's current state. The server re-checks every guard. */
function commandsFor(order: StaffOrderView): Cmd[] {
  const reason = (defaultValue?: string) => ({ name: "reason", label: "Reason", kind: "textarea" as const, defaultValue, help: "Recorded in the order history." });
  const when = { name: "occurredAt", label: "When it happened", kind: "datetime" as const };
  const out: Cmd[] = [];
  const summary = (line: string) => [`Order ${order.reference} · ${formatRwf(order.totalRwf)}`, line];
  if (order.state === "PAID" || order.state === "ON_HOLD") {
    out.push({
      action: "START_PREPARATION",
      capability: "fulfillment.write",
      triggerLabel: order.state === "ON_HOLD" ? "Resume preparation" : "Start preparation",
      triggerVariant: "primary",
      title: order.state === "ON_HOLD" ? "Resume preparation" : "Start preparation",
      summary: summary("Payment and full stock allocation are checked again before the order moves to preparation."),
      fields: [reason(order.state === "ON_HOLD" ? "" : "Picked and packed")],
      confirmLabel: "Start preparation",
    });
  }
  if (order.state === "PREPARING") {
    out.push({
      action: "ASSIGN_RIDER",
      capability: "fulfillment.write",
      triggerLabel: order.riderReference ? "Change rider" : "Assign rider",
      triggerVariant: order.riderReference ? "secondary" : "primary",
      title: "Assign rider",
      summary: summary("Hand the parcel only to this rider."),
      fields: [{ name: "riderReference", label: "Rider reference", defaultValue: order.riderReference ?? "", help: "Courier booking or rider name/ID." }, reason("Rider booked")],
      confirmLabel: "Assign rider",
    });
    if (order.riderReference) {
      out.push({
        action: "HAND_OVER",
        capability: "fulfillment.write",
        triggerLabel: "Record handover",
        triggerVariant: "primary",
        title: "Record handover to the rider",
        summary: summary(`Stock leaves BeautyBOX now and cannot be cancelled from this screen afterwards. Rider: ${order.riderReference}.`),
        warning: order.cancellationRequest ? `The customer asked to cancel: "${order.cancellationRequest.reason}". Handing over declines that request.` : undefined,
        fields: [{ name: "riderReference", label: "Rider collecting the parcel", defaultValue: order.riderReference }, when, reason("Collected by rider")],
        confirmLabel: "Confirm handover",
      });
    }
  }
  if (order.state === "DISPATCHED") {
    out.push({
      action: "CONFIRM_DELIVERY",
      capability: "fulfillment.write",
      triggerLabel: "Confirm delivery",
      triggerVariant: "primary",
      title: "Confirm delivery",
      summary: summary("Record how delivery was confirmed."),
      fields: [when, { name: "confirmationReference", label: "Confirmation", help: "For example: recipient signature, call with recipient.", optional: true }, reason("Delivered")],
      confirmLabel: "Confirm delivery",
    });
    out.push({
      action: "RECORD_FAILED_ATTEMPT",
      capability: "fulfillment.write",
      triggerLabel: "Record failed attempt",
      title: "Record a failed delivery attempt",
      summary: summary("The customer is told we need to contact them. Record who has the goods now."),
      fields: [
        when,
        { name: "custody", label: "Goods are now with", kind: "select", options: [{ value: "RIDER", label: "The rider" }, { value: "BEAUTYBOX", label: "Back at BeautyBOX" }, { value: "RECIPIENT", label: "The recipient" }] },
        reason(),
      ],
      confirmLabel: "Record attempt",
    });
  }
  if (order.state === "PAID" || order.state === "PREPARING") {
    out.push({
      action: "HOLD",
      capability: "fulfillment.write",
      triggerLabel: "Put on hold",
      title: "Put order on hold",
      summary: summary("Preparation and handover stop until the order is resumed."),
      fields: [reason()],
      confirmLabel: "Put on hold",
    });
  }
  if (order.state === "AWAITING_PAYMENT" || order.state === "PAID" || order.state === "PREPARING" || order.state === "ON_HOLD") {
    out.push({
      action: "CANCEL",
      capability: "orders.cancel",
      triggerLabel: "Cancel order",
      title: "Cancel this order",
      summary: summary(
        order.state === "AWAITING_PAYMENT"
          ? "Reserved stock is released. The payment keeps being checked; if it succeeds later, a refund case opens automatically."
          : "Committed stock returns to availability and a refund case opens for the collected payment. This cannot be undone.",
      ),
      warning: order.cancellationRequest ? `Customer request: "${order.cancellationRequest.reason}"` : undefined,
      fields: [reason()],
      confirmLabel: "Cancel order",
    });
  }
  return out;
}

/** What the payment behind a refund can still cover, and what else is waiting on it. */
function refundContext(order: StaffOrderView, receiptId: string): string {
  const receipt = order.receipts.find((x) => x.id === receiptId);
  const waiting = order.refunds.filter((x) => x.receiptId === receiptId && x.state === "REQUESTED").length;
  if (!receipt) return "Payment details unavailable.";
  return `Payment of ${formatRwf(receipt.amountRwf)}: ${formatRwf(receipt.remainingRefundableRwf)} still refundable${waiting > 1 ? `; ${waiting} refund requests are waiting on this payment` : ""}.`;
}

/** Set when the provider's records for a refund from this payment differ from ours (DR-043). */
function refundReviewWarning(order: StaffOrderView, receiptId: string): string | undefined {
  const flagged = order.refunds.some((x) => x.receiptId === receiptId && (x.verificationFlag === "NEEDS_REVIEW" || x.verificationFlag === "MISMATCH"));
  return flagged ? "The provider's records for a refund from this payment differ from ours. Check the payment in the provider's dashboard before refunding again." : undefined;
}

export default async function StaffOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!z.uuid().safeParse(orderId).success) notFound();
  const access = await staffPageAccess("orders.read");
  if (access.kind === "NONE") return null;
  if (access.kind === "FORBIDDEN") return <Notice tone="warning" title="Your role does not include orders." />;
  const staff = access.staff;
  let order: StaffOrderView;
  try {
    order = await getStaffOrder(staff, orderId);
  } catch (error) {
    if (isDomainError(error)) notFound();
    throw error;
  }
  const commands = commandsFor(order).filter((c) => can(staff.role, c.capability));
  const canRefund = can(staff.role, "refunds.request");
  const canApprove = can(staff.role, "refunds.approve");
  const canReconcile = can(staff.role, "payments.reconcile");
  const canSeePayments = can(staff.role, "payments.read") || canRefund;
  const paid = order.receipts.some((r) => r.disposition === "APPLIED");

  return (
    <div className={styles.stack}>
      <p>
        <Link href="/staff/orders">← Orders</Link>
      </p>
      <div className={`${styles.row} u-between`}>
        <h1 className="page-title">
          Order <code>{order.reference}</code>
        </h1>
        <div className={styles.row}>
          <span className={styles.status}>{ORDER_STATE_LABEL[order.state] ?? order.state}</span>
          <span className={styles.status}>Payment: {humanize(order.paymentState)}</span>
          {order.deliveryState ? <span className={styles.status}>Delivery: {humanize(order.deliveryState)}</span> : null}
          {order.isDemo ? <span className={`${styles.status} ${styles.statusWarn}`}>Demo order</span> : null}
        </div>
      </div>

      {order.exceptions.length > 0 ? (
        <Notice tone="warning" title="Needs attention">
          <ul className="u-m-0 u-indent">
            {order.exceptions.map((e) => (
              <li key={e}>{EXCEPTION_LABEL[e] ?? humanize(e)}</li>
            ))}
          </ul>
          {order.cancellationRequest ? (
            <p>
              Customer reason: “{order.cancellationRequest.reason}” ({formatKigaliDateTime(order.cancellationRequest.requestedAt)})
            </p>
          ) : null}
        </Notice>
      ) : null}

      {commands.length > 0 ? (
        <section className={styles.stack} aria-labelledby="actions-title">
          <h2 id="actions-title" className="section-title">
            Next steps
          </h2>
          <div className={styles.row}>
            {commands.map(({ action, capability: _capability, ...dialog }) => (
              <ActionDialog key={action} {...dialog} endpoint={`/staff/orders/${order.id}/commands`} staticBody={{ action, expectedVersion: order.version }} />
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.stack} aria-labelledby="items-title">
        <h2 id="items-title" className="section-title">
          Items
        </h2>
        <div className={styles.tableRegion} role="region" aria-label="Order items" tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Product</th>
                <th scope="col" className={styles.num}>
                  Qty
                </th>
                <th scope="col" className={styles.num}>
                  Line total
                </th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.sku}>
                  <td>
                    <code>{l.sku}</code>
                  </td>
                  <td>
                    {l.title}
                    {Object.values(l.attributes).length > 0 ? ` · ${Object.values(l.attributes).join(", ")}` : ""}
                  </td>
                  <td className={styles.num}>{l.quantity}</td>
                  <td className={styles.num}>{formatRwf(l.lineTotalRwf)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3}>Delivery</td>
                <td className={styles.num}>{formatRwf(order.deliveryRwf)}</td>
              </tr>
              <tr>
                <td colSpan={3}>
                  <strong>Total</strong>
                </td>
                <td className={styles.num}>
                  <strong>{formatRwf(order.totalRwf)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="label-text muted">Stock: {humanize(order.allocationState)}</p>
      </section>

      <section className={styles.stack} aria-labelledby="delivery-title">
        <h2 id="delivery-title" className="section-title">
          Delivery
        </h2>
        <p>
          <strong>{order.recipient.name}</strong> · {order.recipient.phone}
          {order.recipient.landmark ? ` · ${order.recipient.landmark}` : ""}
        </p>
        {order.recipient.email ? <p>E-mail: {order.recipient.email}</p> : null}
        {order.recipient.instructions ? <p>Instructions: {order.recipient.instructions}</p> : null}
        {order.contactVisible && order.destination ? (
          <p className="label-text">
            Pin: {order.destination.lat.toFixed(6)}, {order.destination.lng.toFixed(6)}
          </p>
        ) : (
          <p className="label-text muted">Contact and pin are hidden for your role.</p>
        )}
        <p className="label-text">Rider: {order.riderReference ?? "not assigned"}</p>
        {order.deliveryAttempts.length > 0 ? (
          <ul className="label-text u-m-0 u-indent">
            {order.deliveryAttempts.map((d) => (
              <li key={d.occurredAt}>
                {formatKigaliDateTime(d.occurredAt)}: {humanize(d.outcome)}
                {d.custody ? ` (goods with ${humanize(d.custody)})` : ""}
                {d.reason ? ` · ${d.reason}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {canSeePayments ? (
        <section className={styles.stack} aria-labelledby="payments-title">
          <h2 id="payments-title" className="section-title">
            Payments and refunds
          </h2>
          <div className={styles.tableRegion} role="region" aria-label="Payment attempts" tabIndex={0}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Attempt</th>
                  <th scope="col">Method</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.attempts.map((a) => (
                  <tr key={a.id}>
                    <td>{formatKigaliDateTime(a.createdAt)}</td>
                    <td>{a.method === "MTN_MOMO_RWA" ? "MTN MoMo" : "Airtel Money"}</td>
                    <td>
                      {humanize(a.state)}
                      {a.verificationFlag ? <span className={`${styles.status} ${styles.statusWarn} u-ml-8px`}>{humanize(a.verificationFlag)}</span> : null}
                    </td>
                    <td>
                      {canReconcile && (a.state === "CREATED" || a.state === "PENDING" || a.verificationFlag) ? (
                        <ActionDialog
                          triggerLabel="Check with provider"
                          triggerAriaLabel={`Check payment attempt from ${formatKigaliDateTime(a.createdAt)} with the provider`}
                          title="Check this payment with the provider"
                          summary={[`Order ${order.reference}`, "Looks up the existing deposit. It never asks the customer to pay again."]}
                          endpoint={`/staff/payments/${a.id}/reconcile`}
                          fields={[{ name: "reason", label: "Reason", kind: "textarea", defaultValue: "Customer enquiry" }]}
                          confirmLabel="Check now"
                          operation
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {order.receipts.length > 0 ? (
            <div className={styles.tableRegion} role="region" aria-label="Verified payments" tabIndex={0}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Verified payment</th>
                    <th scope="col">Use</th>
                    <th scope="col" className={styles.num}>
                      Amount
                    </th>
                    <th scope="col" className={styles.num}>
                      Still refundable
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.receipts.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {formatKigaliDateTime(r.verifiedAt)}
                        <br />
                        <span className="muted">
                          Provider id <code>{r.providerPaymentId}</code>
                        </span>
                      </td>
                      <td>{humanize(r.disposition)}</td>
                      <td className={styles.num}>{formatRwf(r.amountRwf)}</td>
                      <td className={styles.num}>{formatRwf(r.remainingRefundableRwf)}</td>
                      <td>
                        {canRefund && r.remainingRefundableRwf > 0 ? (
                          <ActionDialog
                            triggerLabel="Request refund"
                            triggerAriaLabel={`Request refund from the payment verified ${formatKigaliDateTime(r.verifiedAt)}`}
                            title="Request a refund"
                            summary={[`Order ${order.reference}`, `Up to ${formatRwf(r.remainingRefundableRwf)} can be refunded from this payment. Finance approves before anything is sent.`]}
                            warning={refundReviewWarning(order, r.id)}
                            endpoint="/staff/refunds"
                            staticBody={{ orderId: order.id, receiptId: r.id }}
                            fields={[
                              { name: "amountRwf", label: "Amount (RWF)", kind: "amount", defaultValue: String(r.remainingRefundableRwf) },
                              { name: "reason", label: "Reason", kind: "textarea" },
                            ]}
                            confirmLabel="Record request"
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {order.refunds.length > 0 ? (
            <div className={styles.tableRegion} role="region" aria-label="Refunds" tabIndex={0}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Refund</th>
                    <th scope="col" className={styles.num}>
                      Amount
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.refunds.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.reason}
                        {r.providerRefundId ? (
                          <>
                            <br />
                            <span className="muted">
                              Provider id <code>{r.providerRefundId}</code>
                            </span>
                          </>
                        ) : null}
                      </td>
                      <td className={styles.num}>{formatRwf(r.amountRwf)}</td>
                      <td>
                        {humanize(r.state)}
                        {r.state === "FAILED" && r.failureCode ? <span className="muted"> ({humanize(r.failureCode)})</span> : null}
                        {r.resolutionReference ? (
                          <>
                            <br />
                            <span className="muted">
                              Recorded by finance as paid back under provider reference <code>{r.resolutionReference}</code>
                            </span>
                          </>
                        ) : null}
                        {r.verificationFlag === "MISMATCH" ? (
                          <span className={`${styles.status} ${styles.statusWarn} u-ml-8px`}>
                            Provider reported {r.providerAmountRwf === null ? "a different amount" : formatRwf(r.providerAmountRwf)}
                          </span>
                        ) : null}
                        {r.verificationFlag === "NEEDS_REVIEW" ? <span className={`${styles.status} ${styles.statusWarn} u-ml-8px`}>Provider records differ: finance review</span> : null}
                      </td>
                      <td>
                        <div className={styles.row}>
                          {canApprove && r.state === "REQUESTED" ? (
                            <>
                              <ActionDialog
                                triggerLabel="Approve"
                                triggerVariant="primary"
                                triggerAriaLabel={`Approve refund of ${formatRwf(r.amountRwf)}`}
                                title="Approve refund"
                                summary={[
                                  `Order ${order.reference} · ${formatRwf(r.amountRwf)} · reason: ${r.reason}`,
                                  refundContext(order, r.receiptId),
                                  "Approval reserves this amount and sends the refund to the provider. It is shown as complete only after the provider confirms it.",
                                ]}
                                warning={refundReviewWarning(order, r.receiptId)}
                                endpoint={`/staff/refunds/${r.id}/decision`}
                                staticBody={{ decision: "APPROVE", expectedVersion: r.version }}
                                fields={[{ name: "reason", label: "Reason", kind: "textarea" }]}
                                confirmLabel="Approve refund"
                              />
                              <ActionDialog
                                triggerLabel="Reject"
                                triggerAriaLabel={`Reject refund of ${formatRwf(r.amountRwf)}`}
                                title="Reject refund request"
                                summary={[`Order ${order.reference} · ${formatRwf(r.amountRwf)}`]}
                                endpoint={`/staff/refunds/${r.id}/decision`}
                                staticBody={{ decision: "REJECT", expectedVersion: r.version }}
                                fields={[{ name: "reason", label: "Reason", kind: "textarea" }]}
                                confirmLabel="Reject request"
                              />
                            </>
                          ) : null}
                          {canReconcile && (r.state === "SUBMITTED" || r.state === "PENDING") ? (
                            <ActionDialog
                              triggerLabel="Check refund"
                              triggerAriaLabel={`Check refund of ${formatRwf(r.amountRwf)} with the provider`}
                              title="Check this refund with the provider"
                              summary={[`Order ${order.reference} · ${formatRwf(r.amountRwf)}`, "Looks up the same refund. It never sends a second refund."]}
                              endpoint={`/staff/refunds/${r.id}/reconcile`}
                              fields={[{ name: "reason", label: "Reason", kind: "textarea", defaultValue: "Customer enquiry" }]}
                              confirmLabel="Check now"
                              operation
                            />
                          ) : null}
                          {canApprove && r.verificationFlag === "NEEDS_REVIEW" ? (
                            <>
                              <ActionDialog
                                triggerLabel="Records match"
                                triggerAriaLabel={`Records match: close the review of the refund of ${formatRwf(r.amountRwf)}`}
                                title="Close the review: the provider agrees with our record"
                                summary={
                                  r.state === "FAILED"
                                    ? [
                                        `Order ${order.reference} · ${formatRwf(r.amountRwf)} · ${humanize(r.state)}${r.failureCode ? ` (${humanize(r.failureCode)})` : ""}`,
                                        "Use this only when the provider's dashboard shows that no refund of this payment was made by any other route, so this money is still with the shop.",
                                        "If the customer got money back another way (for example a refund made in the dashboard), use Paid by provider instead.",
                                        "Its amount becomes refundable again.",
                                      ]
                                    : [
                                        `Order ${order.reference} · ${formatRwf(r.amountRwf)} · ${humanize(r.state)}`,
                                        "The provider was processing another refund of this payment that this app did not send. Use this when the dashboard shows that refund is a separate one, not a duplicate of this one.",
                                        "If it duplicates this refund, do not close the review: escalate to the founder, because neither choice here reverses money.",
                                      ]
                                }
                                endpoint={`/staff/refunds/${r.id}/review-resolution`}
                                staticBody={{ outcome: "AS_RECORDED", expectedVersion: r.version }}
                                fields={[{ name: "reason", label: "What the provider's dashboard shows", kind: "textarea" }]}
                                confirmLabel="Close review"
                              />
                              {r.state === "FAILED" ? (
                                <ActionDialog
                                  triggerLabel="Paid by provider"
                                  triggerAriaLabel={`Paid by provider: record the refund of ${formatRwf(r.amountRwf)} as paid`}
                                  title="Record this refund as paid by the provider"
                                  summary={[
                                    `Order ${order.reference} · ${formatRwf(r.amountRwf)}`,
                                    "Use this when the provider's dashboard shows the customer got this money back: this refund after all, or a refund made outside the app.",
                                    "The refund is recorded as succeeded for the amount paid back, and the customer is told.",
                                  ]}
                                  endpoint={`/staff/refunds/${r.id}/review-resolution`}
                                  staticBody={{ outcome: "PAID_BY_PROVIDER", expectedVersion: r.version }}
                                  fields={[
                                    { name: "paidAmountRwf", label: "Amount paid back (RWF)", kind: "amount", defaultValue: String(r.amountRwf), help: `At most ${formatRwf(r.amountRwf)}.` },
                                    { name: "providerReference", label: "Provider reference of the refund that paid", kind: "text" },
                                    { name: "reason", label: "What the provider's dashboard shows", kind: "textarea" },
                                  ]}
                                  confirmLabel="Record as paid"
                                />
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={styles.stack} aria-labelledby="messages-title">
        <h2 id="messages-title" className="section-title">
          Customer messages
        </h2>
        {order.notifications.length === 0 ? (
          <p className="muted">No messages yet.</p>
        ) : (
          <ul className="u-m-0 u-indent">
            {order.notifications.map((n) => (
              <li key={`${n.event}-${n.createdAt}`}>
                {humanize(n.event)}: {humanize(n.state)}
                {n.lastErrorCode && n.state !== "ACCEPTED" ? ` (${humanize(n.lastErrorCode)})` : ""}
              </li>
            ))}
          </ul>
        )}
        {can(staff.role, "access.reissue") && paid ? (
          <div>
            <ActionDialog
              triggerLabel="Send a new private link"
              title="Send a new private order link"
              summary={[
                `Order ${order.reference}`,
                "Use only after verifying the customer. Every earlier link and order session stops working, and a new one-time link is sent to the order's contact: by e-mail when the order has an address, otherwise by SMS. You will not see the link.",
              ]}
              endpoint={`/staff/orders/${order.id}/access-links`}
              staticBody={{ expectedVersion: order.version }}
              fields={[
                { name: "verificationCaseReference", label: "Verification case reference" },
                { name: "reason", label: "Reason", kind: "textarea" },
              ]}
              confirmLabel="Revoke and send"
              operation
            />
          </div>
        ) : null}
      </section>

      <section className={styles.stack} aria-labelledby="history-title">
        <h2 id="history-title" className="section-title">
          History
        </h2>
        <ol className="u-m-0 u-indent">
          {order.audit.map((a, i) => (
            <li key={`${a.occurredAt}-${i}`}>
              <span className="tabular">{formatKigaliDateTime(a.occurredAt)}</span> · {humanize(a.action)} · {a.actorLabel}
              {a.reason ? ` · “${a.reason}”` : ""}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
