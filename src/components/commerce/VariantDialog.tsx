"use client";

import { useId, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { Dialog } from "radix-ui";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Money } from "@/components/ui/Money";
import { ApiError } from "@/lib/api-client";
import { productImage } from "@/lib/product-imagery";
import type { PublicProduct } from "@/modules/catalog/catalog";
import { format, messages } from "@/messages";
import styles from "./VariantDialog.module.css";

export const variantLabel = (attributes: Record<string, string>) =>
  Object.values(attributes).join(" / ") || "Standard";

/** Mounted on open so draft selection always starts from the confirmed choice.
 * Escape/Close discard it; only the confirmation commits the selection. */
export function VariantDialog({
  product,
  currentVariantId,
  onConfirm,
  onClose,
  returnFocusRef,
  returnFocusId,
}: {
  product: PublicProduct;
  currentVariantId: string | null;
  onConfirm: (variantId: string) => Promise<void> | void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  returnFocusId?: string;
}) {
  const [draft, setDraft] = useState(currentVariantId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const groupId = useId();
  const variant = product.variants.find((v) => v.id === draft);
  const shade = product.optionLabel?.toLowerCase() === "shade";
  const image = productImage(product);
  const photo = variant?.imageUrl ?? image?.url;
  async function confirmChoice() {
    if (!variant?.isAvailable || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(variant.id);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : messages.errors.generic);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !sending.current) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.panel}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = returnFocusRef?.current;
            if (trigger?.isConnected) trigger.focus();
            else if (returnFocusId)
              document.getElementById(returnFocusId)?.focus();
          }}
        >
          <div className={styles.head}>
            <Dialog.Title>
              {shade ? "Choose a shade" : "Choose an option"}
            </Dialog.Title>
            <button
              type="button"
              aria-label="Close options"
              onClick={() => {
                if (!busy) onClose();
              }}
              disabled={busy}
            >
              <X size={23} aria-hidden="true" />
            </button>
          </div>
          <Dialog.Description className={styles.description}>
            Choose an available {shade ? "shade" : "option"}, then confirm your
            choice.
          </Dialog.Description>
          <div className={styles.scroll}>
            <div className={styles.product}>
              {photo ? (
                <div>
                  <img
                    src={photo}
                    alt={product.title}
                    width={100}
                    height={110}
                  />
                  {!variant?.imageUrl ? <p>Shared product image</p> : null}
                </div>
              ) : null}
              <div>
                <h3>{product.title}</h3>
                <p>{product.packSize}</p>
                <Money
                  amount={
                    variant?.priceRwf ??
                    Math.min(...product.variants.map((v) => v.priceRwf))
                  }
                />
              </div>
            </div>
            <fieldset className={styles.fieldset}>
              <legend>
                {variant
                  ? "Selected: " + variantLabel(variant.attributes)
                  : "Select your " + (shade ? "shade" : "option")}
              </legend>
              <div className={styles.options}>
                {product.variants.map((v) => {
                  const label = variantLabel(v.attributes),
                    checked = draft === v.id;
                  return (
                    <label key={v.id} className={styles.choice}>
                      <input
                        type="radio"
                        name={groupId}
                        value={v.id}
                        checked={checked}
                        disabled={!v.isAvailable || busy}
                        aria-label={
                          v.isAvailable
                            ? label
                            : format(messages.product.unavailableOption, {
                                label,
                              })
                        }
                        onChange={() => {
                          setDraft(v.id);
                          setError(null);
                        }}
                      />
                      <span>
                        {checked ? (
                          <Check size={17} aria-hidden="true" />
                        ) : null}
                        {label}
                        {!v.isAvailable ? <small>Unavailable</small> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <Link href="/help" className={styles.help}>
              Need help choosing?
            </Link>
            {error ? (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            ) : null}
          </div>
          <div className={styles.foot}>
            <Button
              full
              disabled={!variant?.isAvailable}
              busy={busy}
              busyLabel="Confirming your choice"
              onClick={() => void confirmChoice()}
            >
              {variant
                ? "Use " + variantLabel(variant.attributes)
                : "Confirm your choice"}
              <Check size={18} aria-hidden="true" />
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
