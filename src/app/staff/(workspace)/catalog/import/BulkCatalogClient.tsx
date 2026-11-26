"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { api, newIdempotencyKey } from "@/lib/api-client";
import { preflightCatalogBatch, matchesConfirmedDraft, draftJournalKey, type CatalogBatch, type ConfirmedDraft, type CatalogDraft } from "@/lib/catalog-bulk";
import { uploadStaffPhoto } from "@/lib/staff-photo-upload";
import type { StaffProductView } from "@/modules/catalog/admin";
import styles from "@/components/staff/Staff.module.css";

type Category = { id: string; slug: string; title: string };

async function allStaffProducts() {
  const products: StaffProductView[] = [];
  let cursor: string | null = null;
  do {
    const query = cursor ? `?limit=50&cursor=${encodeURIComponent(cursor)}` : "?limit=50";
    const page: { items: StaffProductView[]; nextCursor: string | null } = await api(`/staff/products${query}`);
    products.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return products;
}

async function photoDigest(photo: File): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await photo.arrayBuffer()));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type DraftCheckpoint = Partial<ConfirmedDraft> & { uploadId?: string; uploadIntentKey?: string };
type DraftJournal = { key: string; checkpoint: DraftCheckpoint | null; draft: CatalogDraft; photo: File };
function readCheckpoint(key: string): DraftCheckpoint | null {
  const stored = localStorage.getItem(key);
  if (!stored) return null;
  const entry: unknown = JSON.parse(stored);
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid local import checkpoint; reconcile the existing product manually.");
  const checkpoint = entry as Record<string, unknown>;
  if (checkpoint.storageKey !== undefined && (typeof checkpoint.storageKey !== "string" || !/^products\/[0-9a-f-]{36}\.webp$/.test(checkpoint.storageKey)))
    throw new Error("Invalid photo checkpoint; reconcile the saved photo manually.");
  if (checkpoint.productId !== undefined && typeof checkpoint.productId !== "string") throw new Error("Invalid product checkpoint.");
  if (checkpoint.idempotencyKey !== undefined && typeof checkpoint.idempotencyKey !== "string") throw new Error("Invalid create checkpoint.");
  if (checkpoint.uploadId !== undefined && (typeof checkpoint.uploadId !== "string" || !/^[0-9a-f-]{36}$/.test(checkpoint.uploadId))) throw new Error("Invalid upload checkpoint.");
  if (checkpoint.uploadIntentKey !== undefined && (typeof checkpoint.uploadIntentKey !== "string" || !/^web-[0-9a-f-]{36}$/.test(checkpoint.uploadIntentKey))) throw new Error("Invalid upload intent checkpoint.");
  if (checkpoint.uploadId && !checkpoint.uploadIntentKey) throw new Error("Upload checkpoint is incomplete; reconcile it manually.");
  return checkpoint as DraftCheckpoint;
}

export default function BulkCatalogClient({ categories }: { categories: Category[] }) {
  const [batch, setBatch] = useState<CatalogBatch | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [parseError, setParseError] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [failure, setFailure] = useState("");
  const [done, setDone] = useState(false);
  const preview = useMemo(() => preflightCatalogBatch(batch, files, categories), [batch, files, categories]);

  async function selectManifest(file: File | undefined) {
    setDone(false); setProgress(""); setFailure(""); setBatch(null); setParseError("");
    if (!file) return;
    try {
      const input: unknown = JSON.parse(await file.text());
      setBatch(input as CatalogBatch);
    } catch {
      setParseError("The manifest is not valid JSON.");
    }
  }

  async function importDrafts() {
    if (!batch || preview.errors.length || !preview.drafts.length || running) return;
    setRunning(true); setFailure(""); setDone(false);
    try {
      const photoFiles = new Map(files.map((file) => [file.name, file]));
      const journals = new Map<string, DraftJournal>();
      for (const draft of preview.drafts) {
        const row = batch.products.find((p) => p.slug === draft.slug)!;
        const photo = photoFiles.get(row.photoFile)!;
        const key = await draftJournalKey(draft, photo.name, await photoDigest(photo));
        const checkpoint = readCheckpoint(key);
        // Probe persistent storage before any network mutation, not after an upload.
        localStorage.setItem(key, JSON.stringify(checkpoint ?? {}));
        journals.set(draft.slug, { key, checkpoint, draft, photo });
      }
      const existing = new Map((await allStaffProducts()).map((p) => [p.product.slug, p]));
      // Check every collision before the first upload or write. Never overwrite a
      // product that happens to share a slug or SKU with this batch.
      const occupiedSkus = new Map([...existing.values()].flatMap((p) => p.variants.map((v) => [v.sku, p.product.slug] as const)));
      for (const draft of preview.drafts) {
        const saved = existing.get(draft.slug);
        const checkpoint = journals.get(draft.slug)!.checkpoint;
        if (saved && !matchesConfirmedDraft(saved, draft, checkpoint?.storageKey ? checkpoint as ConfirmedDraft : null)) throw new Error(`${draft.slug}: existing product differs or has no matching photo checkpoint; reconcile it before resuming.`);
        for (const variant of draft.variants) {
          const owner = occupiedSkus.get(variant.sku);
          if (owner && owner !== draft.slug) throw new Error(`${variant.sku}: SKU already belongs to ${owner}. No products imported.`);
        }
      }
      let created = 0; let skipped = 0;
      for (const draft of preview.drafts) {
        const entry = journals.get(draft.slug)!;
        if (existing.has(draft.slug)) {
          const saved = existing.get(draft.slug)!;
          localStorage.setItem(entry.key, JSON.stringify({ ...entry.checkpoint, productId: saved.product.id }));
          skipped++; setProgress(`${created} created, ${skipped} previously confirmed`); continue;
        }
        const checkpoint: DraftCheckpoint = entry.checkpoint ?? {};
        setProgress(`Uploading owned photo and creating ${draft.title} (${created + skipped + 1}/${preview.drafts.length})`);
        let storageKey = checkpoint.storageKey;
        if (!storageKey) {
          checkpoint.uploadIntentKey ??= newIdempotencyKey();
          // The intent key is durable before the request. Once the server returns
          // its upload ID, record it before PUT or finalize can create derivatives.
          localStorage.setItem(entry.key, JSON.stringify(checkpoint));
          const uploaded = await uploadStaffPhoto(entry.photo, draft.title, {
            intentKey: checkpoint.uploadIntentKey,
            uploadId: checkpoint.uploadId,
            onIntent: (uploadId) => {
              checkpoint.uploadId = uploadId;
              localStorage.setItem(entry.key, JSON.stringify(checkpoint));
            },
          });
          if ("rejected" in uploaded) throw new Error(`${draft.slug}: photo rejected: ${uploaded.rejected}`);
          storageKey = uploaded.storageKey;
          checkpoint.storageKey = storageKey;
          // Persist the finalized derivative before attempting a product create.
          localStorage.setItem(entry.key, JSON.stringify(checkpoint));
        }
        checkpoint.idempotencyKey ??= newIdempotencyKey();
        localStorage.setItem(entry.key, JSON.stringify(checkpoint));
        const saved = await api<StaffProductView>("/staff/products", {
          method: "POST", idempotencyKey: checkpoint.idempotencyKey,
          body: { ...draft, media: [{ storageKey, alt: draft.title, variantId: null, sortOrder: 0 }] },
        });
        // A response alone is not a read-back; check the exact saved target before
        // recording a checkpoint that allows any later run to skip it.
        const confirmed = await api<StaffProductView>(`/staff/products/${encodeURIComponent(saved.product.id)}`);
        if (!matchesConfirmedDraft(confirmed, draft, checkpoint.storageKey ? checkpoint as ConfirmedDraft : null))
          throw new Error(`${draft.slug}: saved product read-back did not confirm the owned photo and draft fields. Stop and inspect it.`);
        checkpoint.productId = saved.product.id;
        localStorage.setItem(entry.key, JSON.stringify(checkpoint));
        existing.set(draft.slug, confirmed);
        created++;
        setProgress(`${created} created, ${skipped} previously confirmed`);
      }
      setDone(true);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Import stopped. Check the catalogue before retrying.");
    } finally { setRunning(false); }
  }

  return <div className={styles.stack}>
    <h1 className="page-title">Bulk catalogue drafts</h1>
    <p>Choose a reviewed local JSON manifest and all matching local photos. Preview validates the whole batch before any writes. Photos are uploaded into BeautyBOX storage and re-encoded by the server; supplier URLs are not stored in product records. This creates drafts only — it does not publish, import stock, or remove demos.</p>
    <label htmlFor="catalog-manifest">Manifest (JSON)</label>
    <input id="catalog-manifest" type="file" accept="application/json,.json" disabled={running} onChange={(e) => void selectManifest(e.currentTarget.files?.[0])} />
    <label htmlFor="catalog-photos">Local product photos (select all matching files)</label>
    <input id="catalog-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={running} onChange={(e) => { setDone(false); setFiles(Array.from(e.currentTarget.files ?? [])); }} />
    {parseError && <Notice tone="danger" title={parseError} />}
    {batch && <>
      <p>{batch.products?.length ?? 0} rows · {preview.drafts.length} eligible drafts · {preview.held.length} held · {files.length} local photos.</p>
      {preview.held.length > 0 && <p>Held: {preview.held.join(", ")}. These remain in the manifest for review and are never written.</p>}
      {preview.errors.length > 0 && <Notice tone="danger" title="Preflight failed">{preview.errors.join("; ")}</Notice>}
      {preview.errors.length === 0 && <Notice tone="success" title="Preflight passed. Review the manifest before importing." />}
      <Button disabled={!!preview.errors.length || !preview.drafts.length || running} busy={running} busyLabel="Importing drafts…" onClick={() => void importDrafts()}>Import eligible drafts</Button>
    </>}
    {progress && <p role="status">{progress}</p>}
    {failure && <Notice tone="danger" title="Import stopped">{failure} The per-product browser checkpoint retains finalized photo keys and create idempotency keys. Reopen the same manifest and photos in this browser to reconcile exact server state before retrying; an unattached finalized photo may need staff investigation. Do not clear browser storage or blindly start a different batch.</Notice>}
    {done && <Notice tone="success" title="Draft batch confirmed">Verify every saved product and photo; then review content/rights and use the separate stock CSV import. Publishing requires approved photos and verified variant-level stock.</Notice>}
    <p><Link href="/staff/catalog">Catalogue</Link> · <Link href="/staff/stock/import">Stock import</Link></p>
  </div>;
}
