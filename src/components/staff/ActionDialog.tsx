"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextAreaField, TextField } from "@/components/ui/TextField";
import {
  api,
  ApiError,
  isDefiniteRejection,
  newIdempotencyKey,
} from "@/lib/api-client";
import { announceStaff } from "./StaffAnnouncer";
import styles from "./Staff.module.css";

export type ActionField = {
  name: string;
  label: string;
  kind?: "text" | "textarea" | "amount" | "datetime" | "select";
  defaultValue?: string;
  help?: string;
  options?: { value: string; label: string }[];
  optional?: boolean;
  /** Send a select's "true"/"false" value as a boolean. */
  asBoolean?: boolean;
};

type Operation = {
  id: string;
  state: "PENDING" | "SUCCEEDED" | "FAILED";
  statusUrl: string;
  outcome?: string | null;
};

export type ActionDialogProps = {
  triggerLabel: string;
  triggerVariant?: "primary" | "secondary" | "quiet" | "accent";
  triggerAriaLabel?: string;
  title: string;
  summary: string[];
  warning?: string;
  endpoint: string;
  staticBody?: Record<string, unknown>;
  fields: ActionField[];
  confirmLabel: string;
  /** Announced after success (defaults to "<title>: done."). */
  successMessage?: string;
  method?: "POST" | "PATCH";
  /** The endpoint answers with a pollable Operation (202). */
  operation?: boolean;
};

function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initialValues(fields: ActionField[]): Record<string, string> {
  return Object.fromEntries(
    fields.map((f) => [
      f.name,
      f.defaultValue ??
        (f.kind === "datetime"
          ? localNow()
          : f.kind === "select"
            ? (f.options?.[0]?.value ?? "")
            : ""),
    ]),
  );
}

/**
 * Staff action confirmation (A02/A03 guarded commands): names the record and the
 * consequence, requires a reason, keeps one idempotency key across a network retry,
 * and on a version conflict asks the user to reload instead of forcing the change.
 */
export function ActionDialog(props: ActionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const intent = useRef<{
    key: string;
    endpoint: string;
    method: "POST" | "PATCH";
    body: Record<string, unknown>;
  } | null>(null);
  // True while the last attempt's outcome is unknown (network error, gateway page): the
  // same idempotency key must be reused, even across closing and reopening (RF-27).
  const [uncertain, setUncertain] = useState(false);
  // Incremented to stop any polling loop (dialog closed, reset, unmounted).
  const pollRun = useRef(0);

  useEffect(
    () => () => {
      pollRun.current++;
    },
    [],
  );

  function reset() {
    setErrors({});
    setError(null);
    setConflict(false);
    setOperation(null);
    pollRun.current++;
    if (!uncertain) intent.current = null;
  }

  function succeeded(message?: string) {
    announceStaff(message ?? props.successMessage ?? `${props.title}: done.`);
    // The trigger may disappear after the refresh; keep keyboard focus on the page.
    window.setTimeout(() => document.getElementById("main")?.focus(), 50);
  }

  function body(): Record<string, unknown> | null {
    const out: Record<string, unknown> = { ...(props.staticBody ?? {}) };
    const fieldErrors: Record<string, string> = {};
    for (const f of props.fields) {
      const raw = (values[f.name] ?? "").trim();
      if (!raw) {
        if (!f.optional) fieldErrors[f.name] = "Required.";
        else if (f.kind !== "amount") out[f.name] = "";
        continue;
      }
      if (f.kind === "amount") {
        if (
          !/^\d+$/.test(raw) ||
          !Number.isSafeInteger(Number(raw)) ||
          Number(raw) < 1
        )
          fieldErrors[f.name] = "Enter a whole amount in RWF.";
        else out[f.name] = Number(raw);
      } else if (f.kind === "datetime") {
        const at = new Date(raw);
        if (Number.isNaN(at.getTime()))
          fieldErrors[f.name] = "Enter a date and time.";
        else out[f.name] = at.toISOString();
      } else if (f.asBoolean) {
        out[f.name] = raw === "true";
      } else {
        out[f.name] = raw;
      }
    }
    setErrors(fieldErrors);
    const first = Object.keys(fieldErrors)[0];
    if (first) document.getElementById(`f-${first}`)?.focus();
    return Object.keys(fieldErrors).length > 0 ? null : out;
  }

  async function poll(op: Operation) {
    const run = ++pollRun.current;
    let current = op;
    for (let i = 0; i < 20 && current.state === "PENDING"; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      if (pollRun.current !== run) return;
      try {
        current = await api<Operation>(
          current.statusUrl.replace(/^\/api\/v1/, ""),
        );
      } catch {
        break;
      }
      if (pollRun.current !== run) return;
      setOperation(current);
    }
    if (pollRun.current !== run) return;
    if (current.state !== "PENDING")
      announceStaff(
        current.outcome ??
          `${props.title}: ${current.state === "SUCCEEDED" ? "done" : "not completed"}.`,
      );
    router.refresh();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || conflict) return;
    const payload = intent.current?.body ?? body();
    if (!payload) return;
    setBusy(true);
    setError(null);
    setConflict(false);
    intent.current ??= {
      key: newIdempotencyKey(),
      endpoint: props.endpoint,
      method: props.method ?? "POST",
      body: payload,
    };
    const original = intent.current;
    try {
      const result = await api<Operation | Record<string, unknown>>(
        original.endpoint,
        {
          method: original.method,
          idempotencyKey: original.key,
          body: original.body,
        },
      );
      intent.current = null;
      setUncertain(false);
      if (props.operation) {
        const op = result as Operation;
        setOperation(op);
        if (op.state === "PENDING") void poll(op);
        else {
          announceStaff(op.outcome ?? `${props.title}: done.`);
          router.refresh();
        }
      } else {
        setOpen(false);
        router.refresh();
        succeeded();
      }
    } catch (e) {
      // Keep the key unless the server definitely refused the request (a 4xx answer);
      // after a network error or a gateway page the request may have been applied.
      const definitive = isDefiniteRejection(e);
      setUncertain(!definitive);
      if (definitive) intent.current = null;
      if (e instanceof ApiError) {
        setConflict(e.code === "VERSION_CONFLICT");
        setError(e.message);
        if (e.fieldErrors.length > 0)
          setErrors(
            Object.fromEntries(e.fieldErrors.map((f) => [f.field, f.message])),
          );
        if (definitive && e.fieldErrors[0])
          document.getElementById(`f-${e.fieldErrors[0].field}`)?.focus();
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const describedBy = `${props.endpoint.replace(/[^a-z0-9]/gi, "-")}-summary`;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (next) {
          if (!Object.keys(values).length)
            setValues(initialValues(props.fields));
          if (operation?.state === "PENDING") void poll(operation);
        } else {
          pollRun.current++;
          if (operation && operation.state !== "PENDING") setOperation(null);
        }
      }}
    >
      <Dialog.Trigger asChild>
        <Button
          variant={props.triggerVariant ?? "secondary"}
          aria-label={props.triggerAriaLabel}
        >
          {props.triggerLabel}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={styles.dialog}
          aria-describedby={describedBy}
        >
          <Dialog.Title className="section-title">{props.title}</Dialog.Title>
          <div id={describedBy}>
            {props.summary.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          {props.warning ? (
            <Notice tone="warning" title={props.warning} />
          ) : null}
          {operation ? (
            <div className={styles.stack}>
              <Notice
                tone={
                  operation.state === "SUCCEEDED"
                    ? "success"
                    : operation.state === "FAILED"
                      ? "danger"
                      : "info"
                }
                title={
                  operation.state === "PENDING"
                    ? "Request recorded. Waiting for the result…"
                    : operation.state === "SUCCEEDED"
                      ? "Done"
                      : "Not completed"
                }
                role="status"
              >
                {operation.outcome ? <p>{operation.outcome}</p> : null}
              </Notice>
              <div className={styles.row}>
                <Dialog.Close asChild>
                  <Button variant="secondary">Close</Button>
                </Dialog.Close>
              </div>
            </div>
          ) : (
            <form className={styles.formGrid} onSubmit={submit} noValidate>
              {props.fields.map((f) => {
                const common = {
                  id: `f-${f.name}`,
                  label: f.label,
                  help: f.help,
                  error: errors[f.name] ?? null,
                  optional: f.optional,
                  disabled: busy || uncertain || conflict,
                };
                const value = values[f.name] ?? "";
                const set = (v: string) =>
                  setValues((prev) => ({ ...prev, [f.name]: v }));
                if (f.kind === "textarea")
                  return (
                    <TextAreaField
                      key={f.name}
                      {...common}
                      rows={3}
                      maxLength={500}
                      value={value}
                      onChange={(e) => set(e.target.value)}
                    />
                  );
                if (f.kind === "select") {
                  return (
                    <div key={f.name} className={`${styles.stack} u-gap-4px`}>
                      <label htmlFor={common.id} className="label-text">
                        {f.label}
                      </label>
                      <select
                        id={common.id}
                        value={value}
                        disabled={common.disabled}
                        aria-invalid={errors[f.name] ? true : undefined}
                        aria-describedby={
                          errors[f.name] ? `${common.id}-error` : undefined
                        }
                        onChange={(e) => set(e.target.value)}
                        className={styles.selectCompact}
                      >
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {errors[f.name] ? (
                        <p id={`${common.id}-error`} role="alert">
                          {errors[f.name]}
                        </p>
                      ) : null}
                    </div>
                  );
                }
                return (
                  <TextField
                    key={f.name}
                    {...common}
                    type={f.kind === "datetime" ? "datetime-local" : "text"}
                    inputMode={f.kind === "amount" ? "numeric" : undefined}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                  />
                );
              })}
              {uncertain ? (
                <Notice
                  tone="warning"
                  title="Outcome not confirmed"
                  role="status"
                >
                  <p>
                    Your original entries are locked. Check the outcome using
                    the same request before making another change. You can close
                    and reopen this dialog.
                  </p>
                </Notice>
              ) : null}
              {error ? (
                <Notice
                  tone="danger"
                  title={error}
                  role="alert"
                  actions={
                    conflict ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          reset();
                          setOpen(false);
                          router.refresh();
                        }}
                      >
                        Reload the record
                      </Button>
                    ) : null
                  }
                />
              ) : null}
              <div className={styles.row}>
                <Dialog.Close asChild>
                  <Button variant="secondary">
                    {uncertain ? "Close" : "Cancel"}
                  </Button>
                </Dialog.Close>
                <Button type="submit" busy={busy} disabled={conflict}>
                  {uncertain ? "Check action outcome" : props.confirmLabel}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
