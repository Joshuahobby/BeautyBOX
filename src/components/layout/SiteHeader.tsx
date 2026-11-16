import Link from "next/link";
import { Search } from "lucide-react";
import brand from "@/design/brand/BeautyBox_Platform_Hub_Lockup_Outlined.svg";
import { messages } from "@/messages";
import type { PublicCategory } from "@/modules/catalog/catalog";
import { CartLink, MobileMenu, DesktopNavigation } from "./HeaderClient";
import styles from "./Layout.module.css";

export function SiteHeader({ categories }: { categories: PublicCategory[] }) {
  return (
    <header className={styles.header}>
      <div className={"container " + styles.headerInner}>
        <Link
          href="/"
          className={styles.brand}
          aria-label={messages.brand.homeLabel}
        >
          <img
            src={brand.src}
            alt=""
            width={240}
            height={56}
            decoding="async"
            fetchPriority="high"
          />
        </Link>
        <form
          className={styles.search}
          action="/shop"
          role="search"
          aria-label="Search the beauty shop"
        >
          <label htmlFor="site-search" className="visually-hidden">
            {messages.nav.searchLabel}
          </label>
          <Search size={20} className={styles.searchIcon} aria-hidden="true" />
          <input
            id="site-search"
            className={styles.searchInput}
            type="search"
            name="q"
            placeholder="Search beauty essentials"
            enterKeyHint="search"
          />
        </form>
        <Link href="/shop" className={styles.shopAll}>
          {messages.nav.shopAll}
        </Link>
        <div className={styles.actions}>
          <MobileMenu categories={categories} />
          <CartLink />
        </div>
      </div>
      <DesktopNavigation categories={categories} />
    </header>
  );
}
