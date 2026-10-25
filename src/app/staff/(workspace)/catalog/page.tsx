import Link from "next/link";
import { listStaffProducts } from "@/modules/catalog/admin";
import { ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { staffPageAccess } from "@/server/staff-page";
import styles from "@/components/staff/Staff.module.css";

export const dynamic = "force-dynamic";

const ERROR_TEXT: Record<string, string> = {
  SYNTHETIC_RECORD: "Demo/reference record",
  CONTENT_NOT_REVIEWED: "Content not reviewed",
  DESCRIPTION_MISSING: "No description",
  IMAGE_RIGHTS_NOT_CONFIRMED: "Image rights not confirmed",
  NO_APPROVED_PHOTO: "No approved photo",
  NO_ACTIVE_VARIANT: "No active variant",
  NO_VERIFIED_STOCK: "No counted stock at the shop",
  CATEGORY_UNPUBLISHED: "Category hidden",
};

export default async function StaffCatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await staffPageAccess("catalog.read");
  if (access.kind === "NONE") return null;
  if (access.kind === "FORBIDDEN") return <Notice tone="warning" title="Your role does not include the catalog." />;
  const sp = await searchParams;
  const page = await listStaffProducts({ cursor: sp.cursor ?? null, limit: 25 });
  return (
    <div className={styles.stack}>
      <div className={`${styles.row} u-between`}>
        <h1 className="page-title">Catalog</h1>
        <ButtonLink href="/staff/catalog/new">New product draft</ButtonLink>
      </div>
      <div className={styles.tableRegion} role="region" aria-label="Products" tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Status</th>
              <th scope="col" className={styles.num}>Variants</th>
              <th scope="col">Publication checks</th>
            </tr>
          </thead>
          <tbody>
            {page.items.length === 0 ? (
              <tr>
                <td colSpan={4}>No products yet.</td>
              </tr>
            ) : (
              page.items.map((p) => (
                <tr key={p.product.id}>
                  <td>
                    <Link href={`/staff/catalog/${p.product.id}`}>{p.product.title}</Link>
                    <div className="label-text muted">{p.product.brand}</div>
                  </td>
                  <td>
                    <span className={`${styles.status} ${p.publishState === "PUBLISHED" ? styles.statusOk : ""}`}>{p.publishState.toLowerCase()}</span>
                    {p.isSynthetic ? <span className={`${styles.status} ${styles.statusWarn} u-ml-8px`}>Demo</span> : null}
                  </td>
                  <td className={styles.num}>{p.variants.filter((v) => v.isActive).length}</td>
                  <td>{p.publicationErrors.length === 0 ? "Ready" : p.publicationErrors.map((e) => ERROR_TEXT[e] ?? e).join("; ")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {page.nextCursor ? (
        <p>
          <Link href={`/staff/catalog?cursor=${page.nextCursor}`}>Next page</Link>
        </p>
      ) : null}
    </div>
  );
}
