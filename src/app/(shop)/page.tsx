import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  MapPin,
  ShoppingBag,
  Smartphone,
} from "lucide-react";
import { FeatureCarousel } from "@/components/commerce/FeatureCarousel";
import { productImage } from "@/lib/product-imagery";
import { Notice } from "@/components/ui/Notice";
import { ProductGrid } from "@/components/commerce/ProductCard";
import { listCategories, listProducts } from "@/modules/catalog/catalog";
import { messages } from "@/messages";
import { beautybox } from "@/content/beautybox";
import styles from "./page.module.css";
import { responsiveImage } from "@/lib/responsive-image";

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
    listProducts({
      availableOnly: true,
      standardDeliveryOnly: true,
      limit: 100,
      sort: "NEWEST",
    }),
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
                      {...responsiveImage(
                        `/images/editorial/${categoryImages[c.slug] ?? "green-ritual"}.webp`,
                        "(max-width: 767px) calc((100vw - 60px) / 3), (max-width: 1264px) calc((100vw - 164px) / 6), 184px",
                      )}
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
          {...responsiveImage(
            "/images/editorial/hibiscus-ritual.webp",
            "(max-width: 767px) 50vw, 60vw",
          )}
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
        className={`container ${styles.about}`}
        aria-labelledby="about-heading"
      >
        <div>
          <p className={styles.eyebrow}>BEAUTYBOX · KIGALI</p>
          <h2 id="about-heading" className={styles.display}>
            {beautybox.headline}
          </h2>
        </div>
        <div className="stack-4">
          <p>{beautybox.intro}</p>
          <p>{beautybox.homepageBody}</p>
          <Link href="/about" className={styles.shopLink}>
            {beautybox.aboutLink}
            <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </section>
      <section
        className={"container " + styles.assurances}
        aria-labelledby="shopping-heading"
      >
        <h2 id="shopping-heading" className={styles.assuranceHeading}>
          {messages.home.howHeading}
        </h2>
        <div>
          <ShoppingBag size={24} aria-hidden="true" />
          <h3>{messages.home.guestHeading}</h3>
          <p>{messages.home.guestBody}</p>
        </div>
        <div>
          <MapPin size={24} aria-hidden="true" />
          <h3>{messages.home.deliveryHeading}</h3>
          <p>{messages.home.deliveryBody}</p>
        </div>
        <div>
          <Smartphone size={24} aria-hidden="true" />
          <h3>{messages.home.paymentHeading}</h3>
          <p>{messages.home.paymentBody}</p>
        </div>
      </section>
      <section
        className={"container " + styles.faq}
        aria-labelledby="faq-heading"
      >
        <div className={styles.faqIntro}>
          <h2 id="faq-heading" className={styles.display}>
            {messages.home.faqHeading}
          </h2>
          <p>{messages.home.faqIntro}</p>
          <Link href="/help" className={styles.shopLink}>
            {messages.home.faqHelp}
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
        <div className={styles.faqItems}>
          {messages.home.faq.map((item) => (
            <details key={item.question}>
              <summary>
                {item.question}
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <div className={styles.faqAnswer}>
                <p>{item.answer}</p>
                {"link" in item ? (
                  <Link href={item.link}>{item.linkLabel}</Link>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
