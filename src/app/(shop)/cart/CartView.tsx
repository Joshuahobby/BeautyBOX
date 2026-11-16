"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Money } from "@/components/ui/Money";
import { Notice } from "@/components/ui/Notice";
import { CartProductImage } from "@/components/cart/CartProductImage";
import { CartVariantEditor } from "@/components/cart/CartVariantEditor";
import { useCart } from "@/components/cart/CartProvider";
import { api, ApiError } from "@/lib/api-client";
import type { Cart, CartLine, Checkout } from "@/lib/types";
import { formatRwf } from "@/modules/shared/money";
import { format, messages } from "@/messages";
import styles from "./cart.module.css";

function variantText(attributes: Record<string, string>) {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return null;
  return entries
    .map(([k, v]) =>
      k === "shade" ? format(messages.cart.shade, { shade: v }) : `${k}: ${v}`,
    )
    .join(", ");
}

/** U05 / U05C. The server cart is the truth; the UI never truncates a quantity itself. */
export function CartView() {
  const { cart, status, setLine, removeLine, refresh, announce } = useCart();
  const router = useRouter();
  const [pendingLine, setPendingLine] = useState<string | null>(null);
  const [lineError, setLineError] = useState<{
    variantId: string;
    message: string;
  } | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(line: CartLine, quantity: number) {
    setPendingLine(line.variantId);
    setLineError(null);
    try {
      const next =
        quantity === 0
          ? await removeLine(line.variantId)
          : await setLine(line.variantId, quantity);
      announce(`${messages.cart.subtotal}: ${formatRwf(next.subtotalRwf)}`);
    } catch (e) {
      setLineError({
        variantId: line.variantId,
        message: e instanceof ApiError ? e.message : messages.errors.generic,
      });
    } finally {
      setPendingLine(null);
    }
  }

  async function continueToCheckout(current: Cart) {
    setContinuing(true);
    setError(null);
    try {
      await api<Checkout>("/checkouts", {
        method: "POST",
        body: { cartId: current.id, expectedCartVersion: current.version },
      });
      router.push("/checkout");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : messages.errors.generic);
      await refresh();
      setContinuing(false);
    }
  }

  async function openPendingPayment(current: Cart) {
    if (!current.checkoutId) return;
    const checkout = await api<Checkout>(`/checkouts/${current.checkoutId}`);
    if (checkout.activeAttemptId)
      router.push(`/payment/${checkout.activeAttemptId}`);
  }

  if (status === "loading" || (!cart && status !== "error")) {
    return (
      <p role="status" className="muted">
        {messages.a11y.loading}
      </p>
    );
  }
  if (status === "error" || !cart) {
    return (
      <Notice
        tone="danger"
        title={messages.errors.generic}
        actions={
          <Button variant="secondary" onClick={() => void refresh()}>
            {messages.catalog.retry}
          </Button>
        }
      />
    );
  }
  if (cart.lines.length === 0) {
    return (
      <div className="stack-4">
        <h1 className="page-title">{messages.cart.heading}</h1>
        <p>{messages.cart.empty}</p>
        <ButtonLink href="/shop">{messages.cart.shopProducts}</ButtonLink>
      </div>
    );
  }

  const needsAttention = cart.lines.some((l) =>
    l.issues.some((i) => i !== "PRICE_CHANGED"),
  );
  return (
    <div className="stack-5">
      <div className={styles.cartHead}>
        <h1 id="cart-heading" tabIndex={-1} className="page-title">
          {needsAttention
            ? messages.cart.attentionHeading
            : messages.cart.heading}{" "}
          <span>
            ({cart.lines.reduce((sum, line) => sum + line.quantity, 0)})
          </span>
        </h1>
        <Link href="/shop">Continue shopping</Link>
      </div>
      {cart.paymentPending ? (
        <Notice
          tone="warning"
          title={messages.payment.unresolvedTitle}
          actions={
            <Button
              variant="secondary"
              onClick={() => void openPendingPayment(cart)}
            >
              {messages.payment.checkStatus}
            </Button>
          }
        >
          <p>{messages.cart.paymentPending}</p>
        </Notice>
      ) : null}
      <div className={styles.layout}>
        <ul className={styles.lines} aria-label={messages.cart.heading}>
          {cart.lines.map((line) => {
            const busy = pendingLine === line.variantId;
            const variant = variantText(line.attributes);
            const unavailable = line.issues.includes("UNAVAILABLE");
            const insufficient = line.issues.includes("INSUFFICIENT_STOCK");
            return (
              <li
                key={line.variantId}
                className={styles.line}
                aria-busy={busy || undefined}
              >
                <CartProductImage line={line} />
                <div className={styles.lineBody}>
                  <div className={styles.lineTop}>
                    <Link
                      href={`/products/${line.productSlug}`}
                      className={styles.lineTitle}
                    >
                      {line.title}
                    </Link>
                    <strong>
                      <Money amount={line.lineTotalRwf} />
                    </strong>
                  </div>
                  {variant ? (
                    <>
                      <p className="label-text">{variant}</p>
                      <CartVariantEditor
                        line={line}
                        disabled={busy || cart.paymentPending || unavailable}
                      />
                    </>
                  ) : null}
                  <p className="label-text muted">
                    <Money amount={line.unitPriceRwf} /> each
                  </p>
                  {line.previousUnitPriceRwf !== null ? (
                    <p className="label-text u-warning">
                      {format(messages.cart.priceChanged, {
                        price: formatRwf(line.unitPriceRwf),
                      })}
                    </p>
                  ) : null}
                  {unavailable ? (
                    <Notice
                      tone="warning"
                      title={format(messages.cart.unavailableLine, {
                        title: variant
                          ? `${line.title} (${variant})`
                          : line.title,
                      })}
                    />
                  ) : null}
                  {insufficient ? (
                    <Notice
                      tone="warning"
                      title={format(messages.cart.insufficientLine, {
                        available: line.availableQuantity,
                      })}
                      actions={
                        <Button
                          variant="secondary"
                          busy={busy}
                          onClick={() =>
                            void change(line, line.availableQuantity)
                          }
                          disabled={cart.paymentPending}
                        >
                          {format(messages.cart.useAvailable, {
                            available: line.availableQuantity,
                          })}
                        </Button>
                      }
                    />
                  ) : null}
                  <div className={styles.lineControls}>
                    {!unavailable ? (
                      <div
                        className={styles.qty}
                        role="group"
                        aria-label={`${messages.product.quantity}: ${line.title}`}
                      >
                        <button
                          type="button"
                          aria-label={messages.product.decrease}
                          disabled={
                            busy || cart.paymentPending || line.quantity <= 1
                          }
                          onClick={() => void change(line, line.quantity - 1)}
                        >
                          <Minus size={16} aria-hidden="true" />
                        </button>
                        <span className={styles.qtyValue} aria-live="polite">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={messages.product.increase}
                          disabled={
                            busy ||
                            cart.paymentPending ||
                            line.quantity >=
                              Math.min(99, line.availableQuantity)
                          }
                          onClick={() => void change(line, line.quantity + 1)}
                        >
                          <Plus size={16} aria-hidden="true" />
                        </button>
                      </div>
                    ) : null}
                    <Button
                      variant="quiet"
                      onClick={() => void change(line, 0)}
                      disabled={busy || cart.paymentPending}
                      aria-label={format(messages.cart.removeLabel, {
                        title: line.title,
                      })}
                    >
                      <Trash2 size={16} aria-hidden="true" />{" "}
                      {messages.cart.remove}
                    </Button>
                    {busy ? (
                      <span className={styles.pending}>
                        {messages.cart.updating}
                      </span>
                    ) : null}
                  </div>
                  {lineError?.variantId === line.variantId ? (
                    <p role="alert" className="label-text u-danger u-w-500">
                      {lineError.message}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        <aside
          className={styles.summary}
          aria-label={messages.checkout.summaryHeading}
        >
          <div className={`${styles.row} ${styles.total}`}>
            <span>{messages.cart.subtotal}</span>
            <Money amount={cart.subtotalRwf} />
          </div>
          <p className="label-text muted">{messages.cart.deliveryNote}</p>
          <p className="label-text muted">{messages.cart.recheckNote}</p>
          {error ? <Notice tone="danger" title={error} role="alert" /> : null}
          <Button
            full
            disabled={!cart.canCheckout}
            busy={continuing}
            onClick={() => void continueToCheckout(cart)}
          >
            {cart.canCheckout
              ? messages.cart.continueToCheckout
              : messages.cart.resolveToContinue}
          </Button>
        </aside>
      </div>
    </div>
  );
}
