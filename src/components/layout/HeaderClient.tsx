"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, Search, ShoppingBag, X } from "lucide-react";
import { useCart } from "@/components/cart/CartProvider";
import { format, messages } from "@/messages";
import type { PublicCategory } from "@/modules/catalog/catalog";
import styles from "./Layout.module.css";

export function CartLink() {
  const { count, status } = useCart();
  const label = format(messages.nav.cartCountLabel, { count: status === "ready" ? count : 0 });
  return (
    <Link href="/cart" className={`${styles.iconButton} ${styles.cartButton}`} aria-label={label}>
      <ShoppingBag size={20} strokeWidth={1.75} aria-hidden="true" />
      <span aria-hidden="true" className="tabular">
        {format(messages.nav.cartWithCount, { count: status === "ready" ? count : 0 })}
      </span>
    </Link>
  );
}

/** Mobile disclosure for search and stocked categories; closes on navigation and Escape. */
export function MobileMenu({ categories }: { categories: PublicCategory[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [lastPath, setLastPath] = useState(pathname);

  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={styles.mobileOnly}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.iconButton}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        <span className="visually-hidden">{open ? messages.nav.closeMenu : messages.nav.menu}</span>
      </button>
      <div id={panelId} hidden={!open} className={styles.menuOverlay}>
        <div className={`container ${styles.menuPanel}`}>
          <form action="/shop" role="search" className={styles.mobileSearch}>
            <label htmlFor="mobile-search" className="visually-hidden">
              {messages.nav.searchLabel}
            </label>
            <Search size={18} className={styles.searchIcon} aria-hidden="true" />
            <input id="mobile-search" className={styles.searchInput} type="search" name="q" placeholder={messages.nav.searchPlaceholder} enterKeyHint="search" />
          </form>
          <nav aria-label="Categories">
            <ul className={styles.menuList}>
              <li>
                <Link href="/shop">{messages.nav.shopAll}</Link>
              </li>
              {categories.map((c) => (
                <li key={c.id}>
                  <Link href={`/shop?category=${encodeURIComponent(c.slug)}`}>{c.title}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}
