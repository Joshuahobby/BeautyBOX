"use client";

import { useState } from "react";
import { ProductMedia } from "./ProductMedia";
import { productImage } from "@/lib/product-imagery";
import type { PublicProduct } from "@/modules/catalog/catalog";
import styles from "./ProductGallery.module.css";

export function ProductGallery({
  product,
  variantId,
}: {
  product: PublicProduct;
  variantId: string | null;
}) {
  const [index, setIndex] = useState(0);
  const variant = product.variants.find((v) => v.id === variantId);
  const fallback = productImage(product);
  const images = variant?.imageUrl
    ? [{ url: variant.imageUrl, alt: product.title }]
    : product.images.length
      ? product.images
      : fallback
        ? [fallback]
        : [];
  const selected = images[Math.min(index, images.length - 1)];
  return (
    <div className={styles.gallery}>
      <ProductMedia
        url={selected?.url ?? null}
        alt={selected?.alt}
        title={product.title}
        large
      />
      {images.length > 1 ? (
        <div className={styles.thumbnails} aria-label="Product photographs">
          {images.map((image, i) => (
            <button
              key={image.url}
              type="button"
              aria-label={"View product image " + (i + 1)}
              aria-pressed={index === i}
              onClick={() => setIndex(i)}
            >
              <img src={image.url} alt="" width={90} height={90} />
            </button>
          ))}
        </div>
      ) : null}
      {selected ? (
        <p className={styles.caption}>
          {variant?.imageUrl
            ? "Image for your selected option"
            : "Shared product image"}
          {fallback?.illustrative && !variant?.imageUrl
            ? " · Illustrative photography"
            : ""}
        </p>
      ) : null}
    </div>
  );
}
