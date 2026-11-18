import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { Money } from "@/components/ui/Money";
import { messages } from "@/messages";
import type { PublicProduct } from "@/modules/catalog/catalog";
import { ProductMedia } from "./ProductMedia";
import { productImage } from "@/lib/product-imagery";
import { QuickAdd } from "./QuickAdd";
import styles from "./Commerce.module.css";

/**
 * Card contract (Screen-and-Component-Spec): simple items may quick-add; variable items
 * always say "Choose shade/options"; unavailable items cannot be added. No ratings,
 * urgency or discount badges.
 */
export function ProductCard({
  product,
  imageSizes,
}: {
  product: PublicProduct;
  imageSizes?: string;
}) {
  const prices = product.variants.map((v) => v.priceRwf);
  const min = Math.min(...prices);
  const available = product.variants.some((v) => v.isAvailable);
  const variable = product.variants.length > 1;
  const href = `/products/${product.slug}`;
  const image = productImage(product);
  const choose =
    product.optionLabel?.toLowerCase() === "shade"
      ? messages.product.chooseShade
      : messages.product.chooseOptions;
  return (
    <article className={styles.card}>
      <Link href={href} className={styles.cardLink}>
        <ProductMedia
          url={image?.url ?? null}
          alt={image?.alt}
          title={product.title}
          sizes={imageSizes}
        />
        <div className={styles.cardMeta}>
          <p className={styles.cardBrand}>{product.brand}</p>
          <h3 className={styles.cardTitle}>{product.title}</h3>
          <p className={styles.price}>
            {variable && Math.max(...prices) !== min ? (
              <span className="label-text">From </span>
            ) : null}
            <Money amount={min} />
          </p>
          {!available ? (
            <span className={`${styles.badge} ${styles.badgeNeutral}`}>
              {messages.product.outOfStock}
            </span>
          ) : null}
        </div>
      </Link>
      {image?.illustrative ? (
        <span className={styles.imageNote}>Illustrative image</span>
      ) : null}
      {!available ? null : variable ? (
        <ButtonLink href={href} variant="secondary" full>
          {choose}
        </ButtonLink>
      ) : (
        <QuickAdd variantId={product.variants[0]!.id} title={product.title} />
      )}
    </article>
  );
}

export function ProductGrid({
  products,
  label,
  imageSizes,
}: {
  products: PublicProduct[];
  label: string;
  imageSizes?: string;
}) {
  return (
    <ul className={styles.grid} aria-label={label}>
      {products.map((p) => (
        <li key={p.id}>
          <ProductCard product={p} imageSizes={imageSizes} />
        </li>
      ))}
    </ul>
  );
}
