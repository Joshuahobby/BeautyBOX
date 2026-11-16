"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Truck } from "lucide-react";
import { ProductGallery } from "@/components/commerce/ProductGallery";
import { Notice } from "@/components/ui/Notice";
import { ButtonLink } from "@/components/ui/Button";
import { format, messages } from "@/messages";
import type { PublicProduct } from "@/modules/catalog/catalog";
import { ProductPurchase } from "./ProductPurchase";
import styles from "./product.module.css";

export function ProductExperience({ product }: { product: PublicProduct }) {
  const [variantId, setVariantId] = useState<string | null>(
    product.variants.length === 1 ? product.variants[0]!.id : null,
  );
  const available = product.variants.some((v) => v.isAvailable);
  return (
    <>
      <div className={styles.layout}>
        <ProductGallery product={product} variantId={variantId} />
        <div className={styles.productInfo}>
          <div className="stack-2">
            <p className="label-text muted">
              {product.brand} / {product.categoryTitle}
            </p>
            <h1 className={styles.title}>{product.title}</h1>
            {product.packSize ? (
              <p className="label-text">{product.packSize}</p>
            ) : null}
          </div>
          {available ? (
            <ProductPurchase product={product} onVariantChange={setVariantId} />
          ) : (
            <div className="stack-4">
              <Notice title={messages.product.outOfStock}>
                <p>{messages.product.unavailableBody}</p>
              </Notice>
              <ButtonLink
                href={"/shop?category=" + product.categorySlug}
                variant="secondary"
              >
                {format(messages.product.browseCategory, {
                  category: product.categoryTitle,
                })}
              </ButtonLink>
            </div>
          )}
          <div className={styles.deliveryHelp}>
            <p>
              <Truck size={18} aria-hidden="true" />
              Delivery calculated after you confirm your location.
            </p>
            <Link href="/help/delivery-returns">
              Delivery & returns <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href="/help">
              Need help choosing? <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          {product.isDemo ? (
            <p className={styles.demoNote} role="note">
              {messages.demo.productNotice}
            </p>
          ) : null}
        </div>
      </div>
      <div className={styles.productDetails}>
        <section aria-labelledby="receive-heading">
          <h2 id="receive-heading">What you’ll receive</h2>
          <p>
            1 × {product.title}
            {product.packSize ? ", " + product.packSize : ""}
            {product.optionLabel
              ? ", in your chosen " + product.optionLabel.toLowerCase()
              : ""}
            .
          </p>
        </section>
        <div>
          <details className={styles.details} open>
            <summary>
              Product details
              <ChevronDown size={18} aria-hidden="true" />
            </summary>
            <p>{product.description}</p>
          </details>
          <details className={styles.details}>
            <summary>Delivery & returns</summary>
            <p>
              Confirm your location at checkout to review the delivery fee and
              final total.
            </p>
            <Link href="/help/delivery-returns">
              Read delivery and returns information
            </Link>
          </details>
        </div>
      </div>
    </>
  );
}
