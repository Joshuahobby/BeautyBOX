import Link from "next/link";
import { listStockLots } from "@/modules/inventory/admin";
import { ButtonLink } from "@/components/ui/Button";
import { AdjustStockButton } from "./StockClient";
import { Notice } from "@/components/ui/Notice";
import { staffPageAccess } from "@/server/staff-page";
import styles from "@/components/staff/Staff.module.css";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | undefined>>;

// A04 stock: available = on hand - reserved - committed. Adjustments are reasoned ledger
// events; they can never consume units reserved or committed to customers (T18).
export default async function StaffStockPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await staffPageAccess("catalog.read");
  if (access.kind === "NONE") return null;
  if (access.kind === "FORBIDDEN") return <Notice tone="warning" title="Your role does not include stock." />;
  const sp = await searchParams;
  const sku = sp.sku?.slice(0, 64) || undefined;
  const page = await listStockLots({ cursor: sp.cursor ?? null, sku, limit: 25 });
  return (
    <div className={styles.stack}>
      <div className={`${styles.row} u-between`}>
        <h1 className="page-title">Stock</h1>
        <ButtonLink href="/staff/stock/import" variant="secondary">
          Import counted stock
        </ButtonLink>
      </div>
      <form className={styles.row} action="/staff/stock" role="search">
        <label htmlFor="stock-sku" className="label-text">
          SKU contains
        </label>
        <input id="stock-sku" name="sku" defaultValue={sku} className={styles.filterInput} />
        <button type="submit" className={styles.filterButton}>
          Filter
        </button>
      </form>
      <div className={styles.tableRegion} role="region" aria-label="Stock lots" tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">Product</th>
              <th scope="col">Lot</th>
              <th scope="col">Owner</th>
              <th scope="col" className={styles.num}>On hand</th>
              <th scope="col" className={styles.num}>Reserved</th>
              <th scope="col" className={styles.num}>Committed</th>
              <th scope="col" className={styles.num}>Available</th>
              <th scope="col">Expiry</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {page.items.length === 0 ? (
              <tr>
                <td colSpan={10}>No stock lots match.</td>
              </tr>
            ) : (
              page.items.map((lot) => (
                <tr key={lot.id}>
                  <td>
                    <code>{lot.sku}</code>
                    {lot.isSynthetic ? <span className={`${styles.status} ${styles.statusWarn} u-ml-8px`}>Demo</span> : null}
                  </td>
                  <td>{lot.productTitle}</td>
                  <td>{lot.batchReference}</td>
                  <td>{lot.ownership === "OWNED" ? "BeautyBOX" : "Consigned"}</td>
                  <td className={styles.num}>{lot.onHand}</td>
                  <td className={styles.num}>{lot.reserved}</td>
                  <td className={styles.num}>{lot.committed}</td>
                  <td className={styles.num}>
                    <strong>{lot.available}</strong>
                  </td>
                  <td>{lot.expiryDate ?? "—"}</td>
                  <td>
                    <AdjustStockButton lot={lot} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {page.nextCursor ? (
        <p>
          <Link href={`/staff/stock?${new URLSearchParams({ ...(sku ? { sku } : {}), cursor: page.nextCursor })}`}>Next page</Link>
        </p>
      ) : null}
    </div>
  );
}
