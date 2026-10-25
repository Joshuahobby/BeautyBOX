import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { ProductGrid } from "@/components/commerce/ProductCard";
import { messages } from "@/messages";
import { listCategories, listProducts } from "@/modules/catalog/catalog";
import styles from "./page.module.css";

// U01 Home: compact hero (no stock photography until real imagery exists), stocked
// categories only, and the first products visible without a large promotional block.
export default async function HomePage() {
  const [categories, featured] = await Promise.all([
    listCategories(),
    listProducts({ availableOnly: true, limit: 8, sort: "NEWEST" }),
  ]);
  const top = categories.filter((c) => c.parentId === null);
  return (
    <>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={`container ${styles.heroInner}`}>
          <h1 id="hero-title" className={styles.heroTitle}>
            {messages.home.heroTitle}
          </h1>
          <p className={styles.heroBody}>{messages.home.heroBody}</p>
          <div className={styles.heroActions}>
            <ButtonLink href="/shop">
              {messages.home.shopProducts} <ArrowRight size={18} aria-hidden="true" />
            </ButtonLink>
          </div>
        </div>
      </section>

      {top.length > 0 ? (
        <section className={`container ${styles.section}`} aria-labelledby="categories-title">
          <h2 id="categories-title" className="section-title u-mb-4">
            {messages.home.categoriesHeading}
          </h2>
          <ul className={styles.categories}>
            {top.map((c) => (
              <li key={c.id}>
                <Link className={styles.categoryLink} href={`/shop?category=${encodeURIComponent(c.slug)}`}>
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={`container ${styles.section}`} aria-labelledby="featured-title">
        <div className={styles.sectionHead}>
          <h2 id="featured-title" className="section-title">
            {messages.home.featuredHeading}
          </h2>
          <Link href="/shop">{messages.home.browseAll}</Link>
        </div>
        {featured.items.length > 0 ? (
          <ProductGrid products={featured.items} label={messages.home.featuredHeading} />
        ) : (
          <Notice title={messages.home.noProducts} />
        )}
      </section>
    </>
  );
}
