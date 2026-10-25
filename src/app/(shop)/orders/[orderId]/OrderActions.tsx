"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextAreaField } from "@/components/ui/TextField";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import { messages } from "@/messages";
import styles from "./order.module.css";

/** Customer cancellation REQUEST (not a decision): staff review it against dispatch. */
export function RequestCancellation({ orderId, version }: { orderId: string; version: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reason.trim()) {
      setFieldError("Tell us why you want to cancel.");
      return;
    }
    setBusy(true);
    setError(null);
    setFieldError(null);
    key.current ??= newIdempotencyKey();
    try {
      await api(`/orders/${orderId}/cancellation-requests`, { method: "POST", idempotencyKey: key.current, body: { expectedVersion: version, reason: reason.trim() } });
      key.current = null;
      setOpen(false);
      router.refresh();
    } catch (e) {
      // Keep the same key only when the request may not have arrived (network error).
      if (!(e instanceof ApiError) || e.status !== 0) key.current = null;
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
        // Load the current order (and its version) behind the dialog; the typed reason stays.
        router.refresh();
        setError(messages.order.cancelChanged);
      } else {
        setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      }
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
          setReason("");
          setError(null);
          setFieldError(null);
        }
      }}
    >
      <Dialog.Trigger asChild>
        <Button variant="secondary">{messages.order.cancelButton}</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialog} aria-describedby="cancel-body">
          <Dialog.Title className="section-title">{messages.order.cancelTitle}</Dialog.Title>
          <p id="cancel-body">{messages.order.cancelBody}</p>
          <form className="stack-4" onSubmit={submit} noValidate>
            <TextAreaField id="cancel-reason" label={messages.order.cancelReason} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} error={fieldError} />
            {error ? <Notice tone="danger" title={error} role="alert" /> : null}
            <div className={styles.actions}>
              <Button type="submit" busy={busy}>
                {messages.order.cancelSubmit}
              </Button>
              <Dialog.Close asChild>
                <Button variant="secondary">{messages.order.cancelKeep}</Button>
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** CC-08: one-time private link for the buyer to open this order on another device. */
export function PrivateLink({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ url: string }>(`/orders/${orderId}/access-link`, { method: "POST" });
      setUrl(result.url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
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
          // The link is shown once; closing forgets it.
          setUrl(null);
          setCopied(false);
          setError(null);
        }
      }}
    >
      <Dialog.Trigger asChild>
        <Button variant="quiet">{messages.order.linkButton}</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialog} aria-describedby="link-body">
          <Dialog.Title className="section-title">{messages.order.linkTitle}</Dialog.Title>
          <p id="link-body">{messages.order.linkBody}</p>
          {url ? (
            <>
              <p className={styles.linkBox} aria-label="Private link">
                {url}
              </p>
              <div className={styles.actions}>
                <Button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {messages.order.linkCopy}
                </Button>
                <Dialog.Close asChild>
                  <Button variant="secondary">{messages.order.close}</Button>
                </Dialog.Close>
              </div>
              <p role="status" aria-live="polite" className="label-text">
                {copied ? messages.order.linkCopied : ""}
              </p>
            </>
          ) : (
            <div className={styles.actions}>
              <Button busy={busy} onClick={() => void create()}>
                {messages.order.linkCreate}
              </Button>
              <Dialog.Close asChild>
                <Button variant="secondary">{messages.order.close}</Button>
              </Dialog.Close>
            </div>
          )}
          {error ? <Notice tone="danger" title={error} role="alert" /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
