"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { staffAuthClient } from "@/lib/supabase-browser";
import styles from "./Staff.module.css";

export function StaffNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="Staff">
      <ul className={styles.navList}>
        {items.map((item) => {
          const current = item.href === "/staff" ? pathname === "/staff" : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link href={item.href} className={styles.navLink} aria-current={current ? "page" : undefined}>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="quiet"
      busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await staffAuthClient().auth.signOut();
        } finally {
          router.replace("/staff/sign-in");
          router.refresh();
        }
      }}
    >
      Sign out
    </Button>
  );
}
