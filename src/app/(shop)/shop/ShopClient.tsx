"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProductGrid } from "@/components/commerce/ProductCard";
import { api } from "@/lib/api-client";
import { format, messages } from "@/messages";
import type { PublicCategory, PublicProduct } from "@/modules/catalog/catalog";
import styles from "./shop.module.css";

type Current = { q?: string; category?: string; minPriceRwf?: number; maxPriceRwf?: number; availableOnly?: boolean; sort?: string };

function FilterForm({ categories, current, formId, onSubmitted }: { categories: PublicCategory[]; current: Current; formId: string; onSubmitted?: () => void }) {
  const router = useRouter();
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const [k, v] of data.entries()) if (typeof v === "string" && v.trim() !== "") params.set(k, v.trim());
    onSubmitted?.();
    router.push(`/shop${params.size ? `?${params}` : ""}`);
  }
  return (
    <form id={formId} className={styles.filterForm} onSubmit={submit} action="/shop">
      {current.q ? <input type="hidden" name="q" value={current.q} /> : null}
      <div className="stack-2">
        <label htmlFor={`${formId}-category`} className="label-text u-w-500">
          {messages.catalog.category}
        </label>
        <select id={`${formId}-category`} name="category" defaultValue={current.category ?? ""} className={styles.select}>
          <option value="">{messages.catalog.allCategories}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.parentId ? `  ${c.title}` : c.title}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="stack-2 u-fieldset-bare">
        <legend className="label-text u-w-500">
          {messages.catalog.priceRange}
        </legend>
        <div className={styles.priceRow}>
          <div className="stack-2">
            <label htmlFor={`${formId}-min`} className="label-text muted">
              {messages.catalog.minPrice}
            </label>
            <input id={`${formId}-min`} name="minPriceRwf" type="number" inputMode="numeric" min={0} step={100} defaultValue={current.minPriceRwf ?? ""} className={styles.select} />
          </div>
          <div className="stack-2">
            <label htmlFor={`${formId}-max`} className="label-text muted">
              {messages.catalog.maxPrice}
            </label>
            <input id={`${formId}-max`} name="maxPriceRwf" type="number" inputMode="numeric" min={0} step={100} defaultValue={current.maxPriceRwf ?? ""} className={styles.select} />
          </div>
        </div>
      </fieldset>
      <label className={styles.check}>
        <input type="checkbox" name="availableOnly" value="true" defaultChecked={current.availableOnly} />
        <span>{messages.catalog.availableOnly}</span>
      </label>
      <div className="stack-2">
        <label htmlFor={`${formId}-sort`} className="label-text u-w-500">
          {messages.catalog.sort}
        </label>
        <select id={`${formId}-sort`} name="sort" defaultValue={current.sort ?? ""} className={styles.select}>
          <option value="">{messages.catalog.sortRelevance}</option>
          <option value="PRICE_ASC">{messages.catalog.sortPriceAsc}</option>
          <option value="PRICE_DESC">{messages.catalog.sortPriceDesc}</option>
          <option value="NEWEST">{messages.catalog.sortNewest}</option>
        </select>
      </div>
    </form>
  );
}

/** Inline sidebar on desktop; a bottom sheet on mobile where Close discards the draft. */
export function FilterControls({ categories, current, mode, activeCount = 0 }: { categories: PublicCategory[]; current: Current; mode: "inline" | "sheet"; activeCount?: number }) {
  const [open, setOpen] = useState(false);
  const clearHref = current.q ? `/shop?q=${encodeURIComponent(current.q)}` : "/shop";
  const router = useRouter();
  if (mode === "inline") {
    return (
      <div className="stack-4">
        <h2 className="label-text u-w-600 u-body-size">
          {messages.catalog.filters}
        </h2>
        <FilterForm categories={categories} current={current} formId="filters-inline" />
        <div className="u-grid-3">
          <Button type="submit" form="filters-inline" full>
            {messages.catalog.apply}
          </Button>
          <Button variant="secondary" full onClick={() => router.push(clearHref)}>
            {messages.catalog.clear}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="secondary" className={styles.mobileFilterButton}>
          <SlidersHorizontal size={18} aria-hidden="true" />
          {activeCount > 0 ? format(messages.catalog.filtersApplied, { count: activeCount }) : messages.catalog.filters}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.sheetOverlay} />
        <Dialog.Content className={styles.sheet} aria-describedby={undefined}>
          <div className={styles.sheetHead}>
            <Dialog.Title className="section-title">{messages.catalog.filters}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label={messages.catalog.close} className={styles.sheetClose}>
                <X size={22} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <div className={styles.sheetBody}>
            <FilterForm categories={categories} current={current} formId="filters-sheet" onSubmitted={() => setOpen(false)} />
          </div>
          <div className={styles.sheetFoot}>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                router.push(clearHref);
              }}
            >
              {messages.catalog.clear}
            </Button>
            <Button type="submit" form="filters-sheet">
              {messages.catalog.apply}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Explicit "Load more" (24 per page); the URL keeps the filters, the cursor stays opaque. */
export function LoadMore({ baseQuery, firstCursor }: { baseQuery: string; firstCursor: string }) {
  const [items, setItems] = useState<PublicProduct[]>([]);
  const [cursor, setCursor] = useState<string | null>(firstCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState("");
  const pending = useRef(false);

  async function more() {
    if (!cursor || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    try {
      const params = new URLSearchParams(baseQuery);
      params.set("cursor", cursor);
      params.set("limit", "24");
      const page = await api<{ items: PublicProduct[]; nextCursor: string | null }>(`/catalog/products?${params}`);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setStatus(format("{count} more products loaded", { count: page.items.length }));
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      {items.length > 0 ? <ProductGrid products={items} label={messages.catalog.resultsHeading} /> : null}
      <div className={styles.loadMore}>
        {error ? <p role="alert">{messages.catalog.fetchFailed}</p> : null}
        {cursor ? (
          <Button variant="secondary" onClick={more} busy={busy} busyLabel={messages.catalog.loadingMore}>
            {error ? messages.catalog.retry : messages.catalog.loadMore}
          </Button>
        ) : null}
        <p className="visually-hidden" role="status" aria-live="polite">
          {status}
        </p>
      </div>
    </>
  );
}
