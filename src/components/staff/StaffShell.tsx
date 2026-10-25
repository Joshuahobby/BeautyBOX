import Link from "next/link";
import brandIcon from "@/design/brand/BeautyBox_Platform_Hub_Icon.svg";
import type { Capability } from "@/modules/staff/capabilities";
import type { StaffIdentity } from "@/modules/staff/identity";
import { StaffNav, SignOutButton } from "./StaffClient";
import { StaffAnnouncer } from "./StaffAnnouncer";
import styles from "./Staff.module.css";

const NAV: { href: string; label: string; capability: Capability }[] = [
  { href: "/staff", label: "Overview", capability: "orders.read" },
  { href: "/staff/orders", label: "Orders", capability: "orders.read" },
  { href: "/staff/catalog", label: "Catalog", capability: "catalog.read" },
  { href: "/staff/stock", label: "Stock", capability: "catalog.read" },
  { href: "/staff/finance", label: "Payments & refunds", capability: "payments.read" },
  { href: "/staff/suppliers", label: "Suppliers", capability: "suppliers.read" },
  { href: "/staff/settings", label: "Settings", capability: "settings.read" },
  { href: "/staff/team", label: "Staff", capability: "staff.manage" },
];

/** A08-A10 shell: individual staff identity always visible; navigation shows only permitted areas. */
export function StaffShell({ staff, capabilities, children }: { staff: StaffIdentity; capabilities: readonly Capability[]; children: React.ReactNode }) {
  const items = NAV.filter((n) => capabilities.includes(n.capability) || (n.href === "/staff" && capabilities.length > 0));
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/staff" aria-label="BeautyBOX staff workspace">
          <img src={brandIcon.src} alt="" width={32} height={32} decoding="async" fetchPriority="high" />
        </Link>
        <strong>Staff workspace</strong>
        <div className={styles.who}>
          <span>{staff.displayName}</span>
          <span className={styles.role}>{staff.role}</span>
          <SignOutButton />
        </div>
      </header>
      <div className={styles.workspace}>
        <StaffNav items={items.map(({ href, label }) => ({ href, label }))} />
        <main id="main" className={styles.content} tabIndex={-1}>
          <StaffAnnouncer />
          {children}
        </main>
      </div>
    </div>
  );
}
