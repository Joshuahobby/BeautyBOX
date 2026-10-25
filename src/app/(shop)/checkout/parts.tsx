"use client";

import { forwardRef } from "react";
import { Money } from "@/components/ui/Money";
import { format, messages } from "@/messages";
import type { Cart } from "@/lib/types";
import styles from "./checkout.module.css";

export type StepKey = "contact" | "delivery" | "payment";
const ORDER: StepKey[] = ["contact", "delivery", "payment"];

export function StepProgress({ current }: { current: StepKey }) {
  const index = ORDER.indexOf(current);
  return (
    <nav aria-label={messages.checkout.steps.label}>
      <ol className={styles.steps}>
        {ORDER.map((step, i) => {
          const state = i < index ? "done" : i === index ? "current" : "next";
          return (
            <li
              key={step}
              className={`${styles.step} ${state === "done" ? styles.stepDone : ""} ${state === "current" ? styles.stepCurrent : ""}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span>
                {i + 1}. {messages.checkout.steps[step]}
                {state === "done" ? <span className="visually-hidden"> ({messages.checkout.steps.done})</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export type FieldIssue = { fieldId: string; message: string };

/** Focusable summary after an invalid submit, linking to each field (UX-CONTRACT). */
export const ErrorSummary = forwardRef<HTMLDivElement, { issues: FieldIssue[] }>(function ErrorSummary({ issues }, ref) {
  if (issues.length === 0) return null;
  return (
    <div ref={ref} className={styles.errorSummary} tabIndex={-1} role="alert" aria-labelledby="error-summary-title">
      <p id="error-summary-title" className="u-w-600">
        {messages.checkout.errorSummary}
      </p>
      <ul>
        {issues.map((issue) => (
          <li key={issue.fieldId}>
            <a href={`#${issue.fieldId}`}>{issue.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
});

export function CheckoutSummary({ cart, deliveryRwf }: { cart: Cart | null; deliveryRwf: number | null }) {
  if (!cart) return null;
  const total = deliveryRwf === null ? null : cart.subtotalRwf + deliveryRwf;
  return (
    <aside className={styles.summary} aria-labelledby="summary-title">
      <h2 id="summary-title" className="u-body-size u-w-600">
        {messages.checkout.summaryHeading}
      </h2>
      <ul className={styles.summaryLines}>
        {cart.lines.map((l) => (
          <li key={l.variantId} className={styles.row}>
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
        <Money amount={cart.subtotalRwf} />
      </div>
      <div className={styles.row}>
        <span>{messages.checkout.delivery}</span>
        {deliveryRwf === null ? <span className="muted label-text">{messages.cart.deliveryNote}</span> : <Money amount={deliveryRwf} />}
      </div>
      {total !== null ? (
        <div className={`${styles.row} ${styles.totalRow}`}>
          <span>{messages.checkout.total}</span>
          <Money amount={total} />
        </div>
      ) : null}
      <p className="label-text muted">{format("{count} items", { count: cart.lines.reduce((n, l) => n + l.quantity, 0) })}</p>
    </aside>
  );
}
