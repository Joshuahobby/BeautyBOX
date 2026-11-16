"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextAreaField, TextField } from "@/components/ui/TextField";
import {
  api,
  ApiError,
  isDefiniteRejection,
  newIdempotencyKey,
} from "@/lib/api-client";
import {
  MAX_STOCK_CSV_BYTES,
  parseStockCsv,
  STOCK_CSV_HEADER,
} from "@/lib/stock-csv";
import type { ImportPreviewView } from "@/modules/inventory/admin";
import styles from "@/components/staff/Staff.module.css";

type ApplyIntent = {
  endpoint: string;
  key: string;
  body: { sourceHash: string; reason: string };
};
export default function ImportClient() {
  const [text, setText] = useState(`${STOCK_CSV_HEADER.join(",")}\n`);
  const [preview, setPreview] = useState<ImportPreviewView | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const intent = useRef<ApplyIntent | null>(null);
  const locked = busy || uncertain;
  function changeSource(value: string) {
    setText(value);
    setPreview(null);
    setError(null);
  }
  async function loadFile(file: File | undefined) {
    if (!file || locked) return;
    setPreview(null);
    setError(null);
    if (file.size > MAX_STOCK_CSV_BYTES) {
      setError("Use a CSV file of 256 KiB or less.");
      document.getElementById("import-file")?.focus();
      return;
    }
    setBusy(true);
    try {
      changeSource(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        ),
      );
    } catch {
      setError(
        "The file could not be read as UTF-8. Export it as UTF-8 CSV and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function makePreview() {
    if (locked) return;
    setError(null);
    setPreview(null);
    let rows;
    try {
      rows = parseStockCsv(text);
    } catch (e) {
      setError((e as Error).message);
      document.getElementById("import-csv")?.focus();
      return;
    }
    setBusy(true);
    try {
      setPreview(
        await api<ImportPreviewView>("/staff/inventory/import-previews", {
          method: "POST",
          body: { rows },
        }),
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "The preview could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!preview || busy) return;
    if (!intent.current) {
      if (!reason.trim()) {
        setError("Give a count reference or reason.");
        document.getElementById("import-reason")?.focus();
        return;
      }
      intent.current = {
        endpoint: `/staff/inventory/import-previews/${preview.id}/apply`,
        key: newIdempotencyKey(),
        body: { sourceHash: preview.sourceHash, reason: reason.trim() },
      };
    }
    const original = intent.current;
    setBusy(true);
    setError(null);
    try {
      setPreview(
        await api<ImportPreviewView>(original.endpoint, {
          method: "POST",
          idempotencyKey: original.key,
          body: original.body,
        }),
      );
      intent.current = null;
      setUncertain(false);
    } catch (e) {
      if (isDefiniteRejection(e)) {
        intent.current = null;
        setUncertain(false);
        setError(e.message);
      } else {
        setUncertain(true);
        setError(
          "We could not confirm the import outcome. Keep this page open and check the outcome before starting another import.",
        );
      }
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
        For existing reviewed SKUs only. Each row creates a new lot. Change
        existing lots with a stock adjustment. Demo or reference products cannot
        receive stock.
      </p>
      <p>
        <a href="/staff/stock-import-template.csv" download>
          Download CSV template
        </a>{" "}
        · UTF-8, up to 256 KiB and 1,000 data rows.
      </p>
      <TextField
        id="import-file"
        label="Upload CSV"
        type="file"
        accept=".csv,text/csv"
        optional
        disabled={locked}
        onChange={(e) => void loadFile(e.target.files?.[0])}
      />
      <TextAreaField
        id="import-csv"
        label="CSV rows"
        value={text}
        disabled={locked}
        onChange={(e) => changeSource(e.target.value)}
        rows={8}
        help="Use the template's exact columns. Enter OWNED or CONSIGNED explicitly. Dates use YYYY-MM-DD. Quoted commas, quotes and multiline cells are supported."
      />
      <div className={styles.row}>
        <Button onClick={() => void makePreview()} disabled={locked}>
          Preview import
        </Button>
      </div>
      {error ? <Notice tone="danger" title={error} role="alert" /> : null}
      {preview ? (
        <div className={styles.stack} aria-live="polite">
          <Notice
            tone={
              preview.state === "INVALID"
                ? "warning"
                : preview.state === "APPLIED"
                  ? "success"
                  : "info"
            }
            title={`${preview.state}: ${preview.validRows} of ${preview.rowCount} rows valid`}
          />
          {preview.errors.length ? (
            <div
              className={styles.tableRegion}
              role="region"
              aria-label="Import problems"
              tabIndex={0}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">CSV row</th>
                    <th scope="col">Field</th>
                    <th scope="col">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.errors.map((e, i) => (
                    <tr key={i}>
                      <td>{e.row + 1}</td>
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
              <TextField
                id="import-reason"
                label="Reason / count reference"
                maxLength={500}
                value={reason}
                disabled={locked}
                onChange={(e) => setReason(e.target.value)}
                help="Record the signed count sheet or operations reference."
              />
              <Button
                onClick={() => void apply()}
                busy={busy}
                disabled={busy || (!uncertain && !reason.trim())}
              >
                {uncertain ? "Check import outcome" : "Apply import"}
              </Button>
              {uncertain ? (
                <p>Checking uses the original request. Stock is added once.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
