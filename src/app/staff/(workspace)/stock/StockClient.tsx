"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import styles from "@/components/staff/Staff.module.css";

type Lot = { id: string; sku: string; productTitle: string; batchReference: string; onHand: number; reserved: number; committed: number; available: number; version: number };

/** StockAdjustmentDialog: names SKU, current figures, the change and its reason before confirming. */
export function AdjustStockButton({ lot }: { lot: Lot }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  const change = /^-?\d+$/.test(delta.trim()) ? Number(delta.trim()) : NaN;
  const resulting = Number.isFinite(change) ? lot.onHand + change : null;
  const tooLow = resulting !== null && resulting < lot.reserved + lot.committed;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!Number.isInteger(change) || change === 0) return setError("Enter a whole, non-zero change (negative to remove units).");
    if (tooLow) return setError("This would consume units reserved or committed to customers. Resolve those orders first.");
    setBusy(true);
    setError(null);
    key.current ??= newIdempotencyKey();
    try {
      await api("/staff/inventory/adjustments", {
        method: "POST",
        idempotencyKey: key.current,
        body: { lotId: lot.id, expectedVersion: lot.version, quantityDelta: change, reason, reference },
      });
      key.current = null;
      setOpen(false);
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 0) key.current = null;
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setDelta("");
          setReason("");
          setReference("");
          setError(null);
        }
      }}
    >
      <Dialog.Trigger asChild>
        <Button variant="secondary" aria-label={`Adjust stock for ${lot.sku}, lot ${lot.batchReference}`}>
          Adjust
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialog} aria-describedby="adjust-summary">
          <Dialog.Title className="section-title">Adjust stock</Dialog.Title>
          <p id="adjust-summary">
            <code>{lot.sku}</code> · {lot.productTitle} · lot {lot.batchReference}
            <br />
            On hand {lot.onHand}, reserved {lot.reserved}, committed {lot.committed}, available {lot.available}.
          </p>
          <form className={styles.formGrid} onSubmit={submit} noValidate>
            <TextField id="adj-delta" label="Change in units (use - to remove)" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} help={resulting !== null ? `On hand after this change: ${resulting}` : undefined} error={tooLow ? "Would consume reserved or committed units." : null} />
            <TextField id="adj-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} help="For example: offline sale, damaged, recount." />
            <TextField id="adj-ref" label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} help="Count sheet, receipt or incident reference." />
            {error ? <Notice tone="danger" title={error} role="alert" /> : null}
            <div className={styles.row}>
              <Dialog.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </Dialog.Close>
              <Button type="submit" busy={busy} disabled={tooLow}>
                Confirm adjustment
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
