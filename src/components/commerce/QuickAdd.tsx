"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useCart } from "@/components/cart/CartProvider";
import { ApiError } from "@/lib/api-client";
import { format, messages } from "@/messages";

/** Quick add for simple (single-variant) items: adds one more unit, server-validated. */
export function QuickAdd({
  variantId,
  title,
}: {
  variantId: string;
  title: string;
}) {
  const { cart, setLine, announce } = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current =
    cart?.lines.find((l) => l.variantId === variantId)?.quantity ?? 0;

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await setLine(variantId, current + 1);
      announce(`${messages.product.added}: ${title}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : messages.product.addFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button
        variant="secondary"
        full
        onClick={add}
        busy={busy}
        busyLabel={messages.product.adding}
        aria-label={`${messages.product.addToCart}: ${title}`}
      >
        {messages.product.addToCart}
      </Button>
      {error ? (
        <p role="alert" className="label-text u-danger u-mt-2">
          {error}
        </p>
      ) : null}
      {current > 0 && !error ? (
        <p className="label-text muted u-mt-2">
          {format("{count} in cart", { count: current })}
        </p>
      ) : null}
    </div>
  );
}
