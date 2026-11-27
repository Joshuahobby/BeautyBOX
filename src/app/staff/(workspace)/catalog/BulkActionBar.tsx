"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";

type BulkResult = {
  productId: string;
  ok: boolean;
  publishState?: string;
  code?: string;
  message?: string;
};

type Props = {
  productIds: string[]; // ids of products on this page
};

export function BulkActionBar({ productIds }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [action, setAction] = useState<"PUBLISH" | "ARCHIVE">("ARCHIVE");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: string; text: string; fields?: string[] } | null>(null);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Keep the local selection in sync with the server-rendered checkboxes,
  // including clicks that land outside React (the checkboxes are rendered by
  // the catalog page, not by this form). Querying the document keeps the
  // count and the submit gate accurate however the boxes were clicked.
  useEffect(() => {
    const sync = () => {
      const boxes = document.querySelectorAll<HTMLInputElement>('input[name="productIds"]:checked');
      const ids = Array.from(boxes).map((b) => b.value).filter((id) => productIds.includes(id));
      setSelectedIds(ids);
    };
    sync();
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, [productIds]);

  // Authoritative read: the live checkboxes in the DOM, not React-synced state,
  // so externally clicked checkboxes still drive the action.
  const checkedProductIds = useCallback(() => {
    const boxes = document.querySelectorAll<HTMLInputElement>('input[name="productIds"]:checked');
    return Array.from(boxes).map((b) => b.value).filter((id) => productIds.includes(id));
  }, [productIds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setResults(null);
    const ids = checkedProductIds();
    if (ids.length === 0) {
      setMessage({ tone: "warning", text: "Select at least one product." });
      setBusy(false);
      return;
    }
    if (!reason.trim()) {
      setMessage({ tone: "warning", text: "Enter a reason (recorded in the audit trail)." });
      setBusy(false);
      return;
    }
    try {
      const body = await api<{ results: BulkResult[] }>("/staff/products/bulk-action", {
        method: "POST",
        idempotencyKey: newIdempotencyKey(),
        body: { productIds: ids, action, reason: reason.trim() },
      });
      setResults(body.results);
      const ok = body.results.filter((r) => r.ok).length;
      const total = body.results.length;
      const failed = body.results.filter((r) => !r.ok).length;
      setMessage({
        tone: failed === 0 ? "success" : "warning",
        text: failed === 0 ? `All ${total} product${total === 1 ? "" : "s"} ${action.toLowerCase()}ed.` : `${ok}/${total} ${action.toLowerCase()}ed; ${failed} failed.`,
        fields: failed > 0 ? body.results.filter((r) => !r.ok).map((r) => `${r.productId}: ${r.message ?? r.code}`) : undefined,
      });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "NETWORK", "We couldn't reach BeautyBOX. Check your connection and try again.");
      if (err.status >= 400 && err.status < 500 && err.code !== "UNCERTAIN" && err.code !== "IDEMPOTENCY_CONFLICT") {
        setMessage({
          tone: "danger",
          text: err.message,
          fields: (err.fieldErrors ?? []).map((f: { field: string; message: string }) => `${f.field}: ${f.message}`),
        });
      } else {
        setMessage({ tone: "warning", text: err.message });
      }
    } finally {
      setBusy(false);
    }
  };

  const clearMessage = useCallback(() => {
    setMessage(null);
    setResults(null);
  }, []);

  const isArchive = action === "ARCHIVE";
  const label = isArchive ? "Archive" : "Publish";
  const confirmLabel = isArchive
    ? "Archive selected demo/reference records (keeps audit history)"
    : "Publish selected products (requires all checks to pass)";

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="stack">
      {message && (
        <Notice
          tone={message.tone === "success" ? "success" : message.tone === "warning" ? "warning" : "danger"}
          title={message.text}
          role={message.tone === "danger" ? "alert" : "status"}
        >
          {message.fields ? (
            <ul className="u-m-0 u-indent">
              {message.fields.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      )}
      {results && (
        <Notice tone="info" title="Bulk action results" role="status">
          <ul className="u-m-0 u-indent">
            {results.map((r) => (
              <li key={r.productId}>
                {r.productId}: {r.ok ? `now ${r.publishState?.toLowerCase()}` : `failed — ${r.code}: ${r.message}`}
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={clearMessage}>Dismiss</Button>
        </Notice>
      )}
      <fieldset className="fieldsetPanel" disabled={busy}>
        <legend className="u-w-600">Bulk action</legend>
        <div className="row">
          <label htmlFor="bulk-action" className="label-text u-w-140">Action</label>
          <select id="bulk-action" className="selectField" value={action} onChange={(e) => setAction(e.target.value as "PUBLISH" | "ARCHIVE")}>
            <option value="ARCHIVE">Archive (soft-delete; keeps audit history)</option>
            <option value="PUBLISH">Publish (all checks must pass)</option>
          </select>
        </div>
        <TextField
          id="bulk-reason"
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          help="Recorded in the audit trail. Required for archive."
          required
        />
        <div className="row">
          <span className="label-text muted">
            {selectedIds.length} of {productIds.length} selected on this page
          </span>
        </div>
        <div className="row">
          <Button
            type="submit"
            variant={isArchive ? "secondary" : "primary"}
            busy={busy}
            disabled={!reason.trim() || selectedIds.length === 0}
          >
            {label} selected
          </Button>
          <span className="label-text muted">{confirmLabel}</span>
        </div>
      </fieldset>
    </form>
  );
}
