"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { productImage } from "@/lib/product-imagery";
import type { PublicProduct } from "@/modules/catalog/catalog";
import type { CartLine } from "@/lib/types";
import { ProductMedia } from "@/components/commerce/ProductMedia";
import styles from "./CartExtras.module.css";

export function CartProductImage({ line }: { line: CartLine }) {
  const [product, setProduct] = useState<PublicProduct | null>(null);
  const unavailable = line.issues.includes("UNAVAILABLE");
  useEffect(() => {
    if (unavailable) return;
    const controller = new AbortController();
    void api<PublicProduct>(
      "/catalog/products/" + encodeURIComponent(line.productSlug),
      { signal: controller.signal },
    )
      .then((p) => {
        if (!controller.signal.aborted) setProduct(p);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [line.productSlug, unavailable]);
  const shared = product ? productImage(product) : null;
  const variant = product?.variants.find((v) => v.id === line.variantId);
  return (
    <div className={styles.photo}>
      <ProductMedia
        url={variant?.imageUrl ?? shared?.url ?? null}
        alt={shared?.alt}
        title={line.title}
      />
      {shared && !variant?.imageUrl ? (
        <p>
          Shared product image{shared.illustrative ? " · Illustration" : ""}
        </p>
      ) : null}
    </div>
  );
}
