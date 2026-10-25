"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Money } from "@/components/ui/Money";
import { Notice } from "@/components/ui/Notice";
import { api, ApiError } from "@/lib/api-client";
import { useCart } from "@/components/cart/CartProvider";
import type { PaymentAttempt } from "@/lib/types";
import { format, messages } from "@/messages";

const DELAYED_AFTER_MS = 60_000;

/**
 * U10 / U10U / U11. Shows only what the server has verified. A delay is never shown as
 * a failure, there is no countdown, and no new payment action exists until the
 * provider has confirmed failure (FSD PAY-07, UX spec section 6).
 */
export function PaymentStatus({ attemptId }: { attemptId: string }) {
  const router = useRouter();
  const { refresh: refreshCart } = useCart();
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [ageMs, setAgeMs] = useState(0);
  const [error, setError] = useState<"notFound" | "network" | null>(null);
  const [checking, setChecking] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<number | null>(null);
  const lastState = useRef<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const next = await api<PaymentAttempt>(`/payments/${attemptId}`);
      setAttempt(next);
      setAgeMs(Date.now() - new Date(next.createdAt).getTime());
      setError(null);
      if (lastState.current && lastState.current !== next.state) {
        setAnnouncement(format(messages.payment.statusUpdated, { status: next.state.toLowerCase() }));
      }
      lastState.current = next.state;
      if (next.state === "SUCCEEDED") {
        await refreshCart(); // the paid cart was replaced by a fresh one on the server
        router.replace(`/orders/${next.orderId}`);
      }
      return next;
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "notFound" : "network");
      return null;
    } finally {
      setChecking(false);
    }
  }, [attemptId, router, refreshCart]);

  useEffect(() => {
    let cancelled = false;
    const loop = async () => {
      const next = await check();
      if (cancelled) return;
      const unresolved = !next || next.state === "CREATED" || next.state === "PENDING";
      if (unresolved && document.visibilityState === "visible") {
        timer.current = window.setTimeout(loop, Math.max(3, next?.nextCheckAfterSeconds ?? 5) * 1000);
      }
    };
    void loop();
    const onVisible = () => {
      if (document.visibilityState === "visible" && timer.current === null) void loop();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden" && timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      cancelled = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [check]);

  if (error === "notFound") {
    return (
      <Notice tone="warning" title={messages.order.accessUnavailableTitle} actions={<ButtonLink href="/help" variant="secondary">{messages.checkout.contactSupport}</ButtonLink>}>
        <p>{messages.order.accessUnavailableBody}</p>
      </Notice>
    );
  }
  if (!attempt) {
    return (
      <p role="status" className="muted">
        {error === "network" ? messages.errors.network : messages.a11y.loading}
      </p>
    );
  }

  const unresolved = attempt.state === "CREATED" || attempt.state === "PENDING";
  const delayed = unresolved && (ageMs > DELAYED_AFTER_MS || attempt.verificationFlag !== null);
  const methodLine = format(messages.payment.amountWithMethod, { method: messages.methods[attempt.method], phone: attempt.payerPhoneMasked });

  return (
    <div className="stack-5">
      {attempt.state === "FAILED" ? (
        <>
          <h1 className="page-title">{messages.payment.failedTitle}</h1>
          <Notice tone="danger" title={messages.payment.failedTitle}>
            <p>{messages.payment.failedBody}</p>
            <p>{messages.payment.failedRecheck}</p>
          </Notice>
        </>
      ) : attempt.state === "SUCCEEDED" ? (
        <>
          <h1 className="page-title">{messages.payment.confirmedTitle}</h1>
          <p role="status">{messages.a11y.loading}</p>
        </>
      ) : delayed ? (
        <>
          <h1 className="page-title">{messages.payment.delayedTitle}</h1>
          <Notice tone="warning" title={messages.payment.unresolvedTitle}>
            <p>{messages.payment.unresolvedBody}</p>
            <p>{messages.payment.notDispatched}</p>
          </Notice>
        </>
      ) : (
        <>
          <h1 className="page-title">{messages.payment.pendingTitle}</h1>
          <Notice title={messages.payment.pendingNotice}>
            <p>{messages.payment.pendingBody}</p>
          </Notice>
        </>
      )}

      <dl className="stack-2 u-m-0">
        <div>
          <dt className="label-text muted">{messages.checkout.total}</dt>
          <dd className="u-m-0 u-w-700 u-price-size">
            <Money amount={attempt.amountRwf} />
          </dd>
        </div>
        <div>
          <dt className="visually-hidden">{messages.checkout.payingPhone}</dt>
          <dd className="u-m-0">{methodLine}</dd>
        </div>
        <div>
          <dt className="visually-hidden">Order reference</dt>
          <dd className="tabular u-m-0">
            {format(messages.payment.orderReference, { reference: attempt.orderReference })}
          </dd>
        </div>
      </dl>

      {unresolved ? (
        <div className="stack-3">
          <p className="label-text">{messages.payment.doNotPayAgain}</p>
          <Button variant="secondary" full onClick={() => void check()} busy={checking} busyLabel={messages.payment.checking}>
            {messages.payment.checkStatus}
          </Button>
          <p>
            <Link href="/help">{messages.payment.getHelp}</Link>
          </p>
        </div>
      ) : null}

      {attempt.state === "FAILED" ? (
        <div className="stack-3">
          <ButtonLink href="/checkout" full>
            {messages.payment.reviewAndRetry}
          </ButtonLink>
          <ButtonLink href="/cart" variant="secondary" full>
            {messages.payment.returnToCart}
          </ButtonLink>
        </div>
      ) : null}

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
