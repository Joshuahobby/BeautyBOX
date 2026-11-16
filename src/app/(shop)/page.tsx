import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  PackageCheck,
  MapPin,
  ShoppingBag,
} from "lucide-react";
import { FeatureCarousel } from "@/components/commerce/FeatureCarousel";
import { productImage } from "@/lib/product-imagery";
import { Notice } from "@/components/ui/Notice";
import { ProductGrid } from "@/components/commerce/ProductCard";
import { listCategories, listProducts } from "@/modules/catalog/catalog";
import styles from "./page.module.css";

const categoryImages: Record<string, string> = {
  skincare: "green-ritual",
  makeup: "lip-hue",
  "bath-body": "cleanser",
  fragrance: "hibiscus-ritual",
  haircare: "everyday-beauty",
  "tools-accessories": "makeup-bag",
};

export default async function HomePage() {
  const [categories, catalogue] = await Promise.all([
    listCategories(),
    listProducts({ availableOnly: true, limit: 100, sort: "NEWEST" }),
  ]);
  const top = categories.filter((c) => !c.parentId);
  const preferred = [
    "pure-zen-cleanser",
    "lip-hue",
    "makeup-bag",
    "radishield-sun-cream",
  ];
  const edit = [...catalogue.items]
    .sort((a, b) => {
      const ai = preferred.indexOf(a.slug),
        bi = preferred.indexOf(b.slug);
      return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi);
    })
    .slice(0, 4);
  const affordable = catalogue.items
    .filter((p) => p.variants.some((v) => v.isAvailable && v.priceRwf <= 10000))
    .sort(
      (a, b) =>
        Number(Boolean(productImage(b))) - Number(Boolean(productImage(a))),
    )
    .slice(0, 4);
  const brands = [
    ...new Set(catalogue.items.map((p) => p.brand).filter(Boolean)),
  ].slice(0, 4);
  return (
    <>
      <FeatureCarousel />
      <section
        className={"container " + styles.section}
        aria-labelledby="edit-heading"
      >
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.eyebrow}>A FEW GOOD FINDS</p>
            <h2 id="edit-heading" className={styles.display}>
              The everyday edit
            </h2>
          </div>
          <Link href="/shop" className={styles.shopLink}>
            Shop all <ArrowUpRight size={20} aria-hidden="true" />
          </Link>
        </div>
        {edit.length ? (
          <ProductGrid products={edit} label="The everyday edit" />
        ) : (
          <Notice title="Your next favourites are on their way." />
        )}
      </section>
      {top.length ? (
        <section
          className={"container " + styles.section}
          aria-labelledby="categories-heading"
        >
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>MAKE IT YOURS</p>
              <h2 id="categories-heading" className={styles.display}>
                Find your kind of beauty
              </h2>
            </div>
          </div>
          <ul className={styles.categories}>
            {top.map((c) => (
              <li key={c.id}>
                <Link href={"/shop?category=" + c.slug}>
                  <div className={styles.categoryImage}>
                    <img
                      src={
                        "/images/editorial/" +
                        (categoryImages[c.slug] ?? "green-ritual") +
                        ".webp"
                      }
                      alt=""
                      width={300}
                      height={300}
                      loading="lazy"
                    />
                  </div>
                  <span>
                    {c.title}
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className={styles.ritual} aria-labelledby="ritual-heading">
        <img
          src="/images/editorial/hibiscus-ritual.webp"
          alt=""
          width={1600}
          height={700}
          loading="lazy"
        />
        <div className={"container " + styles.ritualInner}>
          <div>
            <p className={styles.eyebrow}>A MOMENT FOR YOU</p>
            <h2 id="ritual-heading">
              Find your
              <br />
              own rhythm.
            </h2>
            <Link href="/shop?category=skincare">
              Shop skincare <ArrowUpRight size={22} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
      {affordable.length ? (
        <section
          className={"container " + styles.section}
          aria-labelledby="affordable-heading"
        >
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>LITTLE THINGS. EVERYDAY JOY.</p>
              <h2 id="affordable-heading" className={styles.display}>
                Good finds, within reach
              </h2>
              <p className={styles.sectionBody}>
                Explore essentials at RWF 10,000 or less.
              </p>
            </div>
            <Link href="/shop?maxPriceRwf=10000" className={styles.shopLink}>
              Explore the finds <ArrowUpRight size={20} aria-hidden="true" />
            </Link>
          </div>
          <ProductGrid
            products={affordable}
            label="Finds at RWF 10,000 or less"
          />
        </section>
      ) : null}
      {brands.length ? (
        <section
          className={"container " + styles.section}
          aria-labelledby="brands-heading"
        >
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>MORE TO EXPLORE</p>
              <h2 id="brands-heading" className={styles.display}>
                On the beauty shelf
              </h2>
            </div>
          </div>
          <ul className={styles.brands}>
            {brands.map((brand) => (
              <li key={brand}>
                <Link href={"/shop?brand=" + encodeURIComponent(brand)}>
                  <span>Explore the brand</span>
                  <h3>{brand}</h3>
                  <ArrowUpRight size={24} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section
        className={"container " + styles.assurances}
        aria-label="Shopping with BeautyBOX"
      >
        <div>
          <ShoppingBag size={24} aria-hidden="true" />
          <h3>Beauty, all in one place</h3>
          <p>Skincare, makeup and personal care essentials.</p>
        </div>
        <div>
          <MapPin size={24} aria-hidden="true" />
          <h3>Know your total</h3>
          <p>Confirm your location and review delivery before you pay.</p>
        </div>
        <div>
          <PackageCheck size={24} aria-hidden="true" />
          <h3>A little help, whenever</h3>
          <Link href="/help">
            Visit our help centre <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </>
  );
}
