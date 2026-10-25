"use client";

import { useId, useMemo, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Money } from "@/components/ui/Money";
import { Notice } from "@/components/ui/Notice";
import { useCart } from "@/components/cart/CartProvider";
import { ApiError } from "@/lib/api-client";
import { format, messages } from "@/messages";
import type { PublicProduct } from "@/modules/catalog/catalog";
import styles from "./product.module.css";

const MAX_QUANTITY = 99;

function variantLabel(attributes: Record<string, string>): string {
  return Object.values(attributes).join(" / ") || "Standard";
}

/**
 * Variant + quantity + add (U03/U03V). The add action stays disabled with an
 * explanation until a valid option is chosen; unavailable options stay visible and
 * labelled; the server decides availability and price on every add.
 */
export function ProductPurchase({ product }: { product: PublicProduct }) {
  const { cart, setLine, announce } = useCart();
  const single = product.variants.length === 1;
  const [variantId, setVariantId] = useState<string | null>(single ? product.variants[0]!.id : null);
  const [quantityText, setQuantityText] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const groupId = useId();
  const isShade = product.optionLabel?.toLowerCase() === "shade";

  const variant = useMemo(() => product.variants.find((v) => v.id === variantId) ?? null, [product.variants, variantId]);
  const quantity = /^\d+$/.test(quantityText) ? Number(quantityText) : NaN;
  const quantityValid = Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY;
  const inCart = cart?.lines.find((l) => l.variantId === variantId)?.quantity ?? 0;
  const missingChoice = !variant;

  async function add() {
    if (!variant || !quantityValid) return;
    setAdded(false);
    if (inCart + quantity > MAX_QUANTITY) {
      // Never clamp silently: explain the limit and keep the shopper's choice.
      setError(`You can have up to ${MAX_QUANTITY} of this item in your cart (${inCart} already added).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setLine(variant.id, inCart + quantity);
      setAdded(true);
      announce(`${messages.product.added}: ${product.title}${single ? "" : `, ${variantLabel(variant.attributes)}`}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : messages.product.addFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-5">
      <p className={styles.price}>
        <Money amount={variant?.priceRwf ?? Math.min(...product.variants.map((v) => v.priceRwf))} />
      </p>

      {!single ? (
        <fieldset className={styles.options}>
          <legend>{isShade ? messages.product.chooseShadeHeading : messages.product.chooseOptionHeading}</legend>
          <div className={styles.chips} role="radiogroup" aria-describedby={`${groupId}-status`}>
            {product.variants.map((v) => {
              const label = variantLabel(v.attributes);
              const checked = v.id === variantId;
              return (
                <span className={styles.chip} key={v.id}>
                  <input
                    type="radio"
                    id={`${groupId}-${v.id}`}
                    name={groupId}
                    value={v.id}
                    checked={checked}
                    disabled={!v.isAvailable}
                    onChange={() => {
                      setVariantId(v.id);
                      setAdded(false);
                      setError(null);
                    }}
                    aria-label={v.isAvailable ? label : format(messages.product.unavailableOption, { label })}
                  />
                  <label htmlFor={`${groupId}-${v.id}`} className={styles.chipLabel} aria-hidden="true">
                    {checked ? <Check size={16} strokeWidth={2.5} /> : null}
                    {label}
                  </label>
                </span>
              );
            })}
          </div>
          <p id={`${groupId}-status`} className="label-text muted u-mt-2">
            {variant ? format(messages.product.selectedShade, { shade: variantLabel(variant.attributes) }) : messages.product.noShadeSelected}
          </p>
        </fieldset>
      ) : null}

      {variant ? (
        <p className={styles.status}>
          <Check size={16} aria-hidden="true" /> {messages.product.inStock}
        </p>
      ) : null}

      <div className="stack-2">
        <label htmlFor={`${groupId}-qty`} className="label-text u-w-500">
          {messages.product.quantity}
        </label>
        <div className={styles.quantity}>
          <button type="button" aria-label={messages.product.decrease} disabled={!quantityValid || quantity <= 1} onClick={() => setQuantityText(String(quantity - 1))}>
            <Minus size={18} aria-hidden="true" />
          </button>
          <input
            id={`${groupId}-qty`}
            inputMode="numeric"
            pattern="[0-9]*"
            value={quantityText}
            onChange={(e) => setQuantityText(e.target.value.trim())}
            aria-invalid={!quantityValid || undefined}
            aria-describedby={!quantityValid ? `${groupId}-qty-error` : undefined}
          />
          <button type="button" aria-label={messages.product.increase} disabled={!quantityValid || quantity >= MAX_QUANTITY} onClick={() => setQuantityText(String(quantity + 1))}>
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
        {!quantityValid ? (
          <p id={`${groupId}-qty-error`} className="label-text u-danger u-w-500">
            Choose a whole number between 1 and 99.
          </p>
        ) : null}
      </div>

      <div className="stack-2">
        <Button full onClick={add} busy={busy} busyLabel={messages.product.adding} disabled={missingChoice || !quantityValid} aria-describedby={missingChoice ? `${groupId}-why` : undefined}>
          {messages.product.addToCart}
        </Button>
        {missingChoice ? (
          <p id={`${groupId}-why`} className="label-text muted">
            {isShade ? messages.product.variantMissing : messages.product.optionMissing}
          </p>
        ) : null}
      </div>

      {error ? (
        <Notice tone="danger" title={error} role="alert" />
      ) : null}
      {added ? (
        <Notice
          tone="info"
          title={messages.product.added}
          role="status"
          actions={
            <div className={styles.added}>
              <ButtonLink href="/cart">{messages.product.viewCart}</ButtonLink>
              <ButtonLink href="/shop" variant="secondary">
                {messages.product.continueShopping}
              </ButtonLink>
            </div>
          }
        />
      ) : null}
    </div>
  );
}
