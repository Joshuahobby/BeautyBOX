"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextAreaField, TextField } from "@/components/ui/TextField";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import styles from "@/components/staff/Staff.module.css";

type Preview = { id: string; rowCount: number; validRows: number; errors: { row: number; field: string; message: string }[]; state: "INVALID" | "READY" | "APPLIED"; sourceHash: string; expiresAt: string };

const HEADER = ["sku", "quantityOnHand", "ownership", "supplierId", "agreementReference", "batchReference", "expiryDate", "unitCostRwf"] as const;

/** CSV (header row required) -> import rows. Empty cells become null; quantities and costs are integers. */
function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("Add a header row and at least one data row.");
  const header = lines[0]!.split(",").map((h) => h.trim());
  if (HEADER.some((h, i) => header[i] !== h)) throw new Error(`The header must be exactly: ${HEADER.join(",")}`);
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const cell = (i: number) => (cells[i] ? cells[i]! : null);
    return {
      sku: cell(0) ?? "",
      quantityOnHand: Number(cell(1) ?? "NaN"),
      ownership: cell(2) ?? "OWNED",
      supplierId: cell(3),
      agreementReference: cell(4),
      batchReference: cell(5) ?? "",
      expiryDate: cell(6),
      unitCostRwf: cell(7) === null ? null : Number(cell(7)),
    };
  });
}

// Inventory intake (playbook "Prepare the catalog"): counted stock for existing reviewed
// SKUs only, previewed with every problem listed, then applied with a reason.
export default function StockImportPage() {
  const [text, setText] = useState(`${HEADER.join(",")}\n`);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function makePreview() {
    setError(null);
    setPreview(null);
    let rows;
    try {
      rows = parseCsv(text);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    try {
      setPreview(await api<Preview>("/staff/inventory/import-previews", { method: "POST", body: { rows } }));
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}${e.fieldErrors.length ? ` (${e.fieldErrors.slice(0, 3).map((f) => f.field).join(", ")})` : ""}` : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await api<Preview>(`/staff/inventory/import-previews/${preview.id}/apply`, { method: "POST", idempotencyKey: newIdempotencyKey(), body: { sourceHash: preview.sourceHash, reason } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.stack}>
      <p>
        <Link href="/staff/stock">Back to stock</Link>
      </p>
      <h1 className="page-title">Import counted stock</h1>
      <p className="muted">
        For products that already exist and whose content has been reviewed. Each row creates a new lot (batch). Change existing lots with a stock
        adjustment. Demo or reference products cannot receive stock.
      </p>
      <TextAreaField id="import-csv" label="CSV rows" value={text} onChange={(e) => setText(e.target.value)} rows={8} help={`Columns: ${HEADER.join(", ")}. Dates as YYYY-MM-DD. Leave supplier empty for BeautyBOX-owned stock.`} />
      <div className={styles.row}>
        <Button onClick={() => void makePreview()} busy={busy}>
          Preview import
        </Button>
      </div>
      {error ? <Notice tone="danger" title={error} role="alert" /> : null}
      {preview ? (
        <div className={styles.stack} aria-live="polite">
          <Notice tone={preview.state === "INVALID" ? "warning" : preview.state === "APPLIED" ? "success" : "info"} title={`${preview.state}: ${preview.validRows} of ${preview.rowCount} rows valid`} />
          {preview.errors.length > 0 ? (
            <div className={styles.tableRegion} role="region" aria-label="Import problems" tabIndex={0}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Field</th>
                    <th scope="col">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.errors.map((e, i) => (
                    <tr key={i}>
                      <td>{e.row}</td>
                      <td>{e.field}</td>
                      <td>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {preview.state === "READY" ? (
            <div className={styles.formGrid}>
              <TextField id="import-reason" label="Reason / count reference" value={reason} onChange={(e) => setReason(e.target.value)} help="For example: opening count signed off by operations on 2026-10-21." />
              <Button onClick={() => void apply()} busy={busy} disabled={!reason.trim()}>
                Apply import
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
