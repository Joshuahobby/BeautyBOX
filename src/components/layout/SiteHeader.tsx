import Link from "next/link";
import { Search } from "lucide-react";
import brandIcon from "@/design/brand/BeautyBox_Platform_Hub_Icon.svg";
import { messages } from "@/messages";
import type { PublicCategory } from "@/modules/catalog/catalog";
import { CartLink, MobileMenu } from "./HeaderClient";
import styles from "./Layout.module.css";

// Compact shop header: original supplied icon (the full lockup waits for founder
// verification of its live Inter wordmark, B11), stocked categories only, search and
// cart. No account icon: guest checkout has no customer accounts.
export function SiteHeader({ categories }: { categories: PublicCategory[] }) {
  const top = categories.filter((c) => c.parentId === null);
  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerInner}`}>
        <Link href="/" className={styles.brand} aria-label={messages.brand.homeLabel}>
          <img src={brandIcon.src} alt="" width={40} height={40} decoding="async" fetchPriority="high" />
        </Link>
        <nav className={styles.nav} aria-label="Shop">
          <ul className={styles.navList}>
            <li>
              <Link className={styles.navLink} href="/shop">
                {messages.nav.shopAll}
              </Link>
            </li>
            {top.map((c) => (
              <li key={c.id}>
                <Link className={styles.navLink} href={`/shop?category=${encodeURIComponent(c.slug)}`}>
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <form className={styles.search} action="/shop" role="search">
          <label htmlFor="site-search" className="visually-hidden">
            {messages.nav.searchLabel}
          </label>
          <Search size={18} className={styles.searchIcon} aria-hidden="true" />
          <input id="site-search" className={styles.searchInput} type="search" name="q" placeholder={messages.nav.searchPlaceholder} enterKeyHint="search" />
        </form>
        <div className={styles.actions}>
          <MobileMenu categories={top} />
          <CartLink />
        </div>
      </div>
    </header>
  );
}
