import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui/Notice";
import { ButtonLink } from "@/components/ui/Button";
import { ProductGrid } from "@/components/commerce/ProductCard";
import { format, messages } from "@/messages";
import {
  listCategories,
  listProducts,
  type ProductSort,
} from "@/modules/catalog/catalog";
import { productListQuery } from "@/server/http/schemas";
import { FilterControls, LoadMore } from "./ShopClient";
import styles from "./shop.module.css";

export const metadata: Metadata = { title: "Shop" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// U02 / U02E: results reflect the URL (shareable, back-button safe); no PII in queries.
export default async function ShopPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const raw = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(raw)
      .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
      .filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = productListQuery.safeParse(flat);
  type Query = Partial<NonNullable<typeof parsed.data>>;
  const query: Query = parsed.success ? parsed.data : {};
  const [categories, page] = await Promise.all([
    listCategories(),
    listProducts({
      ...query,
      cursor: undefined,
      limit: 24,
      sort: (query.sort as ProductSort | undefined) ?? undefined,
    }).catch(() => null),
  ]);
  const category = categories.find((c) => c.slug === query.category);
  const heading = query.q
    ? format(messages.catalog.showingFor, { query: query.q })
    : (query.brand ?? category?.title ?? messages.catalog.resultsHeading);
  const activeFilters = [
    query.brand,
    query.category,
    query.minPriceRwf,
    query.maxPriceRwf,
    query.availableOnly ? "1" : undefined,
  ].filter(Boolean).length;
  const baseParams = new URLSearchParams(
    Object.entries(flat).filter(([k]) => k !== "cursor") as [string, string][],
  ).toString();

  return (
    <div className="container page">
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span>Shop</span>
      </nav>
      <div className={styles.catalogIntro}>
        <p>YOUR BEAUTY, YOUR WAY</p>
        <p className={styles.catalogDisplay}>
          Find your next everyday favourite.
        </p>
      </div>
      <nav aria-label="Browse categories" className={styles.categoryNav}>
        <Link
          href="/shop"
          aria-current={
            !query.category && !query.q && !query.brand ? "page" : undefined
          }
        >
          Shop all
        </Link>
        {categories
          .filter((c) => !c.parentId)
          .map((c) => (
            <Link
              key={c.id}
              href={"/shop?category=" + c.slug}
              aria-current={query.category === c.slug ? "page" : undefined}
            >
              {c.title}
            </Link>
          ))}
      </nav>
      {!parsed.success ? (
        <Notice tone="warning" title="We couldn't apply those filters.">
          <p>Choose a category or enter a valid price range to continue.</p>
        </Notice>
      ) : null}
      <div className={styles.layout}>
        <aside
          className={styles.filtersInline}
          aria-label={messages.catalog.filters}
        >
          <FilterControls
            categories={categories}
            current={query}
            mode="inline"
          />
        </aside>
        <div className="stack-5">
          <div className={styles.head}>
            <div className="stack-2">
              <h1 className="page-title">{heading}</h1>
              {page ? (
                <p className="muted" role="status">
                  {page.total === 1
                    ? messages.catalog.resultCountOne
                    : format(messages.catalog.resultCount, {
                        count: page.total,
                      })}
                </p>
              ) : null}
            </div>
            <div className={styles.toolbar}>
              <FilterControls
                categories={categories}
                current={query}
                mode="sheet"
                activeCount={activeFilters}
              />
            </div>
          </div>

          {!page ? (
            <Notice
              tone="danger"
              title={messages.catalog.fetchFailed}
              actions={
                <ButtonLink href={`/shop?${baseParams}`} variant="secondary">
                  {messages.catalog.retry}
                </ButtonLink>
              }
            />
          ) : page.items.length === 0 ? (
            <Notice
              title={messages.catalog.noResultsTitle}
              actions={
                <>
                  {activeFilters > 0 ? (
                    <ButtonLink
                      href={
                        query.q
                          ? `/shop?q=${encodeURIComponent(query.q)}`
                          : "/shop"
                      }
                      variant="secondary"
                    >
                      {messages.catalog.clear}
                    </ButtonLink>
                  ) : null}
                  <ButtonLink href="/shop" variant="secondary">
                    {messages.catalog.browseAll}
                  </ButtonLink>
                </>
              }
            >
              <p>{messages.catalog.noResultsBody}</p>
            </Notice>
          ) : (
            <>
              <ProductGrid products={page.items} label={heading} />
              {page.nextCursor ? (
                <LoadMore
                  baseQuery={baseParams}
                  firstCursor={page.nextCursor}
                />
              ) : null}
            </>
          )}
          <p>
            <Link href="/shop">{messages.catalog.browseAll}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
