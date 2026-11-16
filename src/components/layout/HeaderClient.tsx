"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  ChevronDown,
  Menu,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";
import { useCart } from "@/components/cart/CartProvider";
import { format, messages } from "@/messages";
import type { PublicCategory } from "@/modules/catalog/catalog";
import styles from "./Layout.module.css";

export function CartLink() {
  const { count, status } = useCart();
  const label = format(messages.nav.cartCountLabel, {
    count: status === "ready" ? count : 0,
  });
  return (
    <Link
      href="/cart"
      className={`${styles.iconButton} ${styles.cartButton}`}
      aria-label={label}
    >
      <ShoppingBag size={20} strokeWidth={1.75} aria-hidden="true" />
      <span aria-hidden="true" className="tabular">
        {format(messages.nav.cartWithCount, {
          count: status === "ready" ? count : 0,
        })}
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
        {open ? (
          <X size={22} aria-hidden="true" />
        ) : (
          <Menu size={22} aria-hidden="true" />
        )}
        <span className="visually-hidden">
          {open ? messages.nav.closeMenu : messages.nav.menu}
        </span>
      </button>
      <div id={panelId} hidden={!open} className={styles.menuOverlay}>
        <div className={`container ${styles.menuPanel}`}>
          <form action="/shop" role="search" className={styles.mobileSearch}>
            <label htmlFor="mobile-search" className="visually-hidden">
              {messages.nav.searchLabel}
            </label>
            <Search
              size={18}
              className={styles.searchIcon}
              aria-hidden="true"
            />
            <input
              id="mobile-search"
              className={styles.searchInput}
              type="search"
              name="q"
              placeholder={messages.nav.searchPlaceholder}
              enterKeyHint="search"
            />
          </form>
          <nav aria-label="Categories">
            <ul className={styles.menuList}>
              <li>
                <Link href="/shop" onClick={() => setOpen(false)}>
                  {messages.nav.shopAll}
                </Link>
              </li>
              {categories
                .filter((c) => !c.parentId)
                .map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/shop?category=${encodeURIComponent(c.slug)}`}
                      onClick={() => setOpen(false)}
                    >
                      {c.title}
                    </Link>
                  </li>
                ))}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}

/** A disclosure navigation: native links, ordinary Tab order, Escape and outside close.
 * It does not use ARIA menu roles, which would impose application-style arrow keys. */
export function DesktopNavigation({
  categories,
}: {
  categories: PublicCategory[];
}) {
  const [active, setActive] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const prefix = useId();
  const top = categories.filter((c) => !c.parentId);
  const current = top.find((c) => c.id === active);
  useEffect(() => {
    if (!active) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setActive(null);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [active]);
  return (
    <nav
      ref={root}
      className={styles.departments}
      aria-label="Shop departments"
      onKeyDown={(event) => {
        if (event.key === "Escape" && active) {
          setActive(null);
          triggers.current.get(active)?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setActive(null);
      }}
    >
      <ul className={"container " + styles.departmentList}>
        {top.map((category) => (
          <li key={category.id}>
            <button
              type="button"
              ref={(node) => {
                if (node) triggers.current.set(category.id, node);
              }}
              className={styles.departmentButton}
              aria-expanded={active === category.id}
              aria-controls={prefix + "-" + category.id}
              onClick={() =>
                setActive(active === category.id ? null : category.id)
              }
            >
              {category.title}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <div
              id={prefix + "-" + category.id}
              hidden={active !== category.id}
              className={styles.megaPanel}
            >
              <div className={"container " + styles.megaInner}>
                <div>
                  <p className={styles.eyebrow}>THE BEAUTYBOX SHELF</p>
                  <h2>{category.title}</h2>
                  <Link
                    href={"/shop?category=" + category.slug}
                    onClick={() => setActive(null)}
                    className={styles.textLink}
                  >
                    Shop all {category.title.toLowerCase()}{" "}
                    <ArrowUpRight size={18} aria-hidden="true" />
                  </Link>
                </div>
                <ul className={styles.megaLinks}>
                  {categories
                    .filter((c) => c.parentId === category.id)
                    .map((child) => (
                      <li key={child.id}>
                        <Link
                          href={"/shop?category=" + child.slug}
                          onClick={() => setActive(null)}
                        >
                          {child.title}
                          <ArrowUpRight size={16} aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  <li>
                    <Link
                      href={"/shop?category=" + category.slug + "&sort=NEWEST"}
                      onClick={() => setActive(null)}
                    >
                      Explore the latest{" "}
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={
                        "/shop?category=" + category.slug + "&maxPriceRwf=10000"
                      }
                      onClick={() => setActive(null)}
                    >
                      Finds under RWF 10,000{" "}
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </Link>
                  </li>
                </ul>
                <div className={styles.megaNote}>
                  <p>Make room for your next favourite.</p>
                  <Link
                    href="/help/delivery-returns"
                    onClick={() => setActive(null)}
                  >
                    Delivery & returns
                  </Link>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {current ? (
        <span className="visually-hidden" role="status">
          Browsing {current.title}
        </span>
      ) : null}
    </nav>
  );
}
