import Link from "next/link";
import { Notice } from "@/components/ui/Notice";
import { ActionDialog } from "@/components/staff/ActionDialog";
import { humanize } from "@/components/staff/labels";
import { formatKigaliDateTime } from "@/messages";
import { listObligations, listSuppliers } from "@/modules/suppliers/suppliers";
import { formatRwf } from "@/modules/shared/money";
import { can } from "@/modules/staff/capabilities";
import { staffPageAccess } from "@/server/staff-page";
import styles from "@/components/staff/Staff.module.css";

export const dynamic = "force-dynamic";

// Supplier records (internal only; suppliers never use this system) and manual settlement
// evidence for consigned stock. Recording a settlement moves no money.
export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await staffPageAccess("suppliers.read");
  if (access.kind === "NONE") return null;
  if (access.kind === "FORBIDDEN") return <Notice tone="warning" title="Your role does not include supplier records." />;
  const state = access;
  const role = state.staff.role;
  if (!can(role, "suppliers.read")) return <Notice tone="warning" title="Your role does not include supplier records." />;
  const sp = await searchParams;
  const view = sp.view === "settled" ? "SETTLED" : "OPEN";
  const suppliers = await listSuppliers({ limit: 50 });
  const canWrite = can(role, "suppliers.write");
  const canSettle = can(role, "suppliers.settle");
  const obligations = canSettle ? await listObligations({ limit: 50, state: view }) : null;

  return (
    <div className={styles.stack}>
      <div className={`${styles.row} u-between`}>
        <h1 className="page-title">Suppliers</h1>
        {canWrite ? (
          <ActionDialog
            triggerLabel="Add supplier"
            triggerVariant="primary"
            title="Add a supplier"
            summary={["Internal record for consigned or supplied stock. Suppliers get no access to BeautyBOX systems."]}
            endpoint="/staff/suppliers"
            fields={[
              { name: "name", label: "Supplier name" },
              { name: "agreementReference", label: "Agreement reference", help: "The signed agreement or purchase terms reference." },
            ]}
            confirmLabel="Add supplier"
          />
        ) : null}
      </div>
      <div className={styles.tableRegion} role="region" aria-label="Suppliers" tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Agreement</th>
              <th scope="col">Status</th>
              {canWrite ? (
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {suppliers.items.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 4 : 3}>No suppliers yet.</td>
              </tr>
            ) : (
              suppliers.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    {s.isDemo ? <span className={`${styles.status} ${styles.statusWarn} u-ml-8px`}>Demo</span> : null}
                  </td>
                  <td>{s.agreementReference || "—"}</td>
                  <td>
                    <span className={`${styles.status} ${s.isActive ? styles.statusOk : styles.statusWarn}`}>{s.isActive ? "Active" : "Inactive"}</span>
                  </td>
                  {canWrite ? (
                    <td>
                      <ActionDialog
                        triggerLabel="Edit"
                        triggerAriaLabel={`Edit ${s.name}`}
                        title={`Edit ${s.name}`}
                        summary={["Agreement changes apply to future sales only; recorded obligations keep their amounts."]}
                        endpoint={`/staff/suppliers/${s.id}`}
                        method="PATCH"
                        staticBody={{ expectedVersion: s.version }}
                        fields={[
                          { name: "name", label: "Supplier name", defaultValue: s.name },
                          { name: "agreementReference", label: "Agreement reference", defaultValue: s.agreementReference },
                          { name: "isActive", label: "Status", kind: "select", asBoolean: true, defaultValue: s.isActive ? "true" : "false", options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }] },
                          { name: "reason", label: "Reason", kind: "textarea" },
                        ]}
                        confirmLabel="Save supplier"
                      />
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {obligations ? (
        <section className={styles.stack} aria-labelledby="obligations-title">
          <h2 id="obligations-title" className="section-title">
            Amounts owed to suppliers
          </h2>
          <p className="muted">
            Created when a consigned unit is sold. Record a settlement only after paying the supplier outside BeautyBOX, and only once the goods were handed to the rider.
          </p>
          <nav aria-label="Obligation status" className={styles.row}>
            <Link href="/staff/suppliers" aria-current={view === "OPEN" ? "page" : undefined}>
              Open
            </Link>
            <Link href="/staff/suppliers?view=settled" aria-current={view === "SETTLED" ? "page" : undefined}>
              Settled
            </Link>
          </nav>
          <div className={styles.tableRegion} role="region" aria-label="Supplier obligations" tabIndex={0}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Supplier</th>
                  <th scope="col">Item</th>
                  <th scope="col" className={styles.num}>
                    Amount
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {obligations.items.length === 0 ? (
                  <tr>
                    <td colSpan={6}>Nothing here.</td>
                  </tr>
                ) : (
                  obligations.items.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/staff/orders/${o.orderId}`}>
                          <code>{o.orderReference}</code>
                        </Link>
                      </td>
                      <td>{o.supplierName}</td>
                      <td>
                        <code>{o.sku}</code> × {o.quantity}
                      </td>
                      <td className={styles.num}>{o.amountRwf === null ? "Not valued" : formatRwf(o.amountRwf)}</td>
                      <td>
                        {o.settlementState === "SETTLED"
                          ? `Settled${o.settledAt ? ` ${formatKigaliDateTime(o.settledAt)}` : ""} · ${o.manualReference ?? ""}`
                          : o.blockedReason ?? `Ready to settle (goods ${humanize(o.allocationState)})`}
                      </td>
                      <td>
                        {o.settleable ? (
                          <ActionDialog
                            triggerLabel="Record settlement"
                            triggerAriaLabel={`Record settlement for ${o.orderReference}, ${o.supplierName}`}
                            title="Record a supplier settlement"
                            summary={[`${o.supplierName} · ${o.sku} × ${o.quantity} · ${formatRwf(o.amountRwf ?? 0)}`, "This records a payment you already made outside BeautyBOX. It does not send money."]}
                            endpoint={`/staff/supplier-obligations/${o.id}/settlement`}
                            staticBody={{ expectedVersion: o.version }}
                            fields={[
                              { name: "manualReference", label: "Payment reference", help: "Bank or mobile-money transaction reference." },
                              { name: "reason", label: "Note", kind: "textarea" },
                            ]}
                            confirmLabel="Record settlement"
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
