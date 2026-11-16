"use client";

import { useRef, useState } from "react";
import type { CartLine } from "@/lib/types";
import type { PublicProduct } from "@/modules/catalog/catalog";
import { api, ApiError } from "@/lib/api-client";
import { useCart } from "./CartProvider";
import { VariantDialog } from "@/components/commerce/VariantDialog";
import styles from "./CartExtras.module.css";

export function CartVariantEditor({
  line,
  disabled,
}: {
  line: CartLine;
  disabled: boolean;
}) {
  const [product, setProduct] = useState<PublicProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { replaceLine, announce } = useCart();
  async function open() {
    setBusy(true);
    setError(null);
    try {
      setProduct(
        await api<PublicProduct>(
          "/catalog/products/" + encodeURIComponent(line.productSlug),
          { signal: AbortSignal.timeout(10000) },
        ),
      );
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "We couldn't load the options. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        ref={trigger}
        type="button"
        className={styles.change}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={() => void open()}
      >
        {busy
          ? "Loading options…"
          : "Change " + (line.attributes.shade ? "shade" : "option")}
      </button>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {product && !disabled ? (
        <VariantDialog
          product={product}
          currentVariantId={line.variantId}
          returnFocusRef={trigger}
          returnFocusId="cart-heading"
          onClose={() => setProduct(null)}
          onConfirm={async (id) => {
            await replaceLine(line.variantId, id);
            announce("Your cart option and subtotal have been updated.");
          }}
        />
      ) : null}
    </div>
  );
}
