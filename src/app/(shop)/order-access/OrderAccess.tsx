"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { api, ApiError } from "@/lib/api-client";
import { messages } from "@/messages";

type State = { kind: "opening" } | { kind: "expired" } | { kind: "invalid" } | { kind: "error"; message: string };

/**
 * Reads the one-time token from the URL fragment (never sent to the server as a path),
 * removes it from the address bar and history, exchanges it once for an order-scoped
 * cookie, then opens the private order page. The token is kept only in memory so a
 * network failure can be retried without the link.
 */
export function OrderAccess() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "opening" });
  const started = useRef(false);
  const token = useRef<string | null>(null);

  const exchange = useCallback(async () => {
    await Promise.resolve();
    const value = token.current;
    if (!value || value.length < 40 || value.length > 200) {
      setState({ kind: "invalid" });
      return;
    }
    setState({ kind: "opening" });
    try {
      const result = await api<{ orderId: string }>("/order-access/exchange", { method: "POST", body: { token: value } });
      token.current = null;
      router.replace(`/orders/${result.orderId}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        token.current = null;
        setState({ kind: /expired/i.test(error.message) ? "expired" : "invalid" });
      } else {
        setState({ kind: "error", message: error instanceof ApiError ? error.message : "Something went wrong. Please try again." });
      }
    }
  }, [router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    token.current = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", "/order-access");
    void exchange();
  }, [exchange]);

  if (state.kind === "opening") {
    return (
      <p role="status" aria-live="polite">
        {messages.order.accessOpening}
      </p>
    );
  }
  const title = state.kind === "expired" ? messages.order.accessExpiredTitle : state.kind === "invalid" ? messages.order.accessInvalidTitle : messages.order.accessUnavailableTitle;
  const body = state.kind === "expired" ? messages.order.accessExpiredBody : state.kind === "invalid" ? messages.order.accessInvalidBody : state.message;
  return (
    <div className="stack-4">
      <h1 className="page-title">{title}</h1>
      <p role={state.kind === "error" ? "alert" : undefined}>{body}</p>
      <p className="muted">{messages.order.orderUnchanged}</p>
      <div className="u-flex-wrap-3">
        {state.kind === "error" ? <Button onClick={() => void exchange()}>Try again</Button> : null}
        <ButtonLink href="/help" variant={state.kind === "error" ? "secondary" : "primary"}>
          {messages.checkout.contactSupport}
        </ButtonLink>
        <ButtonLink href="/shop" variant="secondary">
          {messages.order.continueShopping}
        </ButtonLink>
      </div>
    </div>
  );
}
