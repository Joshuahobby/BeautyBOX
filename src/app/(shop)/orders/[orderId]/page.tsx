import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { z } from "zod";
import { ButtonLink } from "@/components/ui/Button";
import { Money } from "@/components/ui/Money";
import { Notice } from "@/components/ui/Notice";
import { format, formatKigaliDateTime, messages } from "@/messages";
import { GUEST_COOKIE, resolveGuestSession } from "@/modules/session/guest-session";
import { orderSessionTokensFrom } from "@/modules/orders/access";
import { getCustomerOrderView, type CustomerOrderView } from "@/modules/orders/customer-views";
import { isDomainError } from "@/modules/shared/errors";
import { formatRwf } from "@/modules/shared/money";
import { PrivateLink, RequestCancellation } from "./OrderActions";
import styles from "./order.module.css";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Step = { key: string; label: string; state: "complete" | "current" | "next" };

function progress(order: CustomerOrderView): Step[] {
  const order_ = ["PAID", "PREPARING", "DISPATCHED", "DELIVERED"];
  const labels = [messages.order.stepPaid, messages.order.stepPreparing, messages.order.stepDispatched, messages.order.stepDelivered];
  const index = order_.indexOf(order.state);
  return order_.map((key, i) => ({
    key,
    label: labels[i]!,
    state: index === -1 ? "next" : i < index || (i === index && key === "DELIVERED") ? "complete" : i === index ? (key === "PAID" ? "complete" : "current") : "next",
  }));
}

// U12 / U13 / U13E. Only the original guest session or an order-scoped session can see
// an order; anything else gets the same generic message whether or not it exists.
export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const jar = await cookies();
  let order: CustomerOrderView | null = null;
  if (z.uuid().safeParse(orderId).success) {
    try {
      order = await getCustomerOrderView(orderId, {
        guestSession: await resolveGuestSession(jar.get(GUEST_COOKIE)?.value),
        orderSessionTokens: orderSessionTokensFrom(jar.getAll()),
      });
    } catch (error) {
      if (!isDomainError(error)) throw error;
    }
  }

  if (!order) {
    return (
      <div className="container page u-max-712">
        <div className="stack-4">
          <h1 className="page-title">{messages.order.accessUnavailableTitle}</h1>
          <p>{messages.order.accessUnavailableBody}</p>
          <p className="muted">{messages.order.orderUnchanged}</p>
          <div className="u-flex-wrap-3">
            <ButtonLink href="/help">{messages.checkout.contactSupport}</ButtonLink>
            <ButtonLink href="/shop" variant="secondary">
              {messages.order.continueShopping}
            </ButtonLink>
          </div>
        </div>
      </div>
    );
  }

  const confirmed = order.state === "PAID" && order.paymentState === "PAID";
  const onHold = order.state === "ON_HOLD";
  const stateMessage =
    order.state === "CANCELLED" && order.paymentState === "PENDING" ? messages.order.cancelledUnresolved : messages.order.states[order.state as keyof typeof messages.order.states];
  const steps = progress(order);

  return (
    <div className="container page">
      <div className={styles.layout}>
        <div className="stack-5">
          <div className="stack-2">
            <h1 className="page-title">{confirmed ? messages.order.confirmedHeading : format(messages.order.orderHeading, { reference: order.reference })}</h1>
            <p className="tabular muted">{format(messages.payment.orderReference, { reference: order.reference })}</p>
          </div>
          {order.isDemo ? <Notice tone="warning" title="Demo order: synthetic products and a simulated payment. Nothing will be delivered." /> : null}

          {confirmed ? (
            <Notice tone="success" title={messages.order.paymentConfirmed} role="status">
              <p>{format(messages.order.paymentReceivedAmount, { amount: formatRwf(order.totalRwf) })}</p>
            </Notice>
          ) : onHold ? (
            <Notice tone="warning" title={order.holdReason === "PAYMENT_REVIEW" ? messages.payment.unresolvedTitle : messages.payment.holdTitle} role="status">
              <p>
                {order.paymentState === "REFUNDED"
                  ? messages.order.refundedHold
                  : order.holdReason === "PAYMENT_REVIEW"
                    ? messages.order.paymentReviewHold
                    : order.holdReason === "MANUAL"
                      ? messages.order.manualHold
                      : messages.payment.holdBody}
              </p>
            </Notice>
          ) : order.state === "DISPATCHED" && order.fulfillment?.state === "FAILED_ATTEMPT" ? (
            <Notice tone="warning" title={messages.order.deliveryFailedTitle} role="status" actions={<ButtonLink href="/help" variant="secondary">{messages.checkout.contactSupport}</ButtonLink>}>
              <p>{messages.order.deliveryFailedBody}</p>
            </Notice>
          ) : order.state === "DELIVERED" && order.fulfillment?.deliveredAt ? (
            <Notice tone="success" title={format(messages.order.deliveredOn, { time: formatKigaliDateTime(order.fulfillment.deliveredAt) })} role="status" />
          ) : order.state === "AWAITING_PAYMENT" ? (
            <Notice title={messages.order.states.AWAITING_PAYMENT} actions={order.latestAttempt ? <ButtonLink href={`/payment/${order.latestAttempt.id}`} variant="secondary">{messages.payment.checkStatus}</ButtonLink> : null} />
          ) : (
            <Notice tone={order.state === "DELIVERED" ? "success" : "info"} title={stateMessage ?? order.state} role="status" />
          )}

          {order.cancellationRequest?.state === "PENDING" ? <Notice title={messages.order.cancelPending} role="status" /> : null}
          {order.cancellationRequest?.state === "FAILED" && order.state !== "CANCELLED" ? (
            <Notice tone="warning" title={messages.order.cancelDeclined}>
              {order.cancellationRequest.outcome ? <p>{order.cancellationRequest.outcome}</p> : null}
            </Notice>
          ) : null}

          {!onHold && order.state !== "CANCELLED" && order.state !== "AWAITING_PAYMENT" ? (
            <section aria-labelledby="progress-title" className="stack-3">
              <h2 id="progress-title" className="section-title">
                {messages.order.progress}
              </h2>
              <ol className={styles.progress}>
                {steps.map((s, i) => (
                  <li key={s.key} className={styles[s.state]}>
                    <span className={styles.dot} aria-hidden="true">
                      {i + 1}
                    </span>
                    <span>
                      {s.label}
                      <span className="visually-hidden">
                        {" "}
                        ({s.state === "complete" ? messages.order.stepComplete : s.state === "current" ? messages.order.stepCurrent : messages.order.stepNext})
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {order.refunds.length > 0 ? (
            <section className="stack-2" aria-labelledby="refunds-title">
              <h2 id="refunds-title" className="section-title">
                Refunds
              </h2>
              {order.refunds.map((r) => (
                <Notice
                  key={r.id}
                  tone={r.state === "SUCCEEDED" ? "success" : r.state === "FAILED" || r.state === "UNDER_REVIEW" ? "warning" : "info"}
                  title={
                    r.state === "SUCCEEDED"
                      ? format(messages.order.refundConfirmed, { amount: formatRwf(r.amountRwf) })
                      : r.state === "FAILED"
                        ? messages.order.refundInvestigating
                        : r.state === "UNDER_REVIEW"
                          ? messages.order.refundUnderReview
                          : format(messages.order.refundPending, { amount: formatRwf(r.amountRwf) })
                  }
                />
              ))}
            </section>
          ) : null}

          <section className="stack-3" aria-labelledby="deliver-title">
            <h2 id="deliver-title" className="section-title">
              {messages.order.deliverTo}
            </h2>
            <p>
              <strong>{order.recipient.name}</strong>
              {order.recipient.landmark ? ` · ${order.recipient.landmark}` : ""}
            </p>
            <p className="label-text muted">Confirmed map pin</p>
            <p className="label-text">
              <strong>{messages.order.deliveryWindow}:</strong>{" "}
              {order.fulfillment?.promisedWindowStart ? formatKigaliDateTime(order.fulfillment.promisedWindowStart) : messages.order.deliveryWindowPending}
            </p>
          </section>

          <p className="label-text muted">{messages.order.keepPrivate}</p>
          <div className="u-flex-wrap-3">
            {order.canRequestCancellation ? <RequestCancellation orderId={order.id} version={order.version} /> : null}
            {order.canCreatePrivateLink ? <PrivateLink orderId={order.id} /> : null}
            <ButtonLink href="/shop" variant="secondary">
              {messages.order.continueShopping}
            </ButtonLink>
            <Link href="/help" className="u-self-center">
              {messages.order.help}
            </Link>
          </div>
        </div>

        <aside className={styles.summary} aria-labelledby="items-title">
          <h2 id="items-title" className="u-body-size u-w-600">
            {messages.order.items}
          </h2>
          <ul className={styles.lines}>
            {order.lines.map((l) => (
              <li key={l.sku} className={styles.row}>
                <span>
                  {l.title}
                  {l.attributes.shade ? ` / ${l.attributes.shade}` : ""} × {l.quantity}
                </span>
                <Money amount={l.lineTotalRwf} />
              </li>
            ))}
          </ul>
          <div className={styles.row}>
            <span>{messages.checkout.products}</span>
            <Money amount={order.productsRwf} />
          </div>
          <div className={styles.row}>
            <span>{messages.checkout.delivery}</span>
            <Money amount={order.deliveryRwf} />
          </div>
          <div className={`${styles.row} ${styles.total}`}>
            <span>{messages.order.total}</span>
            <Money amount={order.totalRwf} />
          </div>
        </aside>
      </div>
    </div>
  );
}
