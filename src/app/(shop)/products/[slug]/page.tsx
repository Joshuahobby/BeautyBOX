import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductMedia } from "@/components/commerce/ProductMedia";
import { Notice } from "@/components/ui/Notice";
import { ButtonLink } from "@/components/ui/Button";
import { format, messages } from "@/messages";
import { getProductBySlug } from "@/modules/catalog/catalog";
import { ProductPurchase } from "./ProductPurchase";
import styles from "./product.module.css";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const product = await getProductBySlug((await params).slug);
  return { title: product?.title ?? messages.errors.notFoundTitle };
}

// U03 / U03V / U04. Drafts and archived products 404 (CAT-01). No reviews, urgency or
// fabricated claims; description is the reviewed text stored for the product.
export default async function ProductPage({ params }: { params: Params }) {
  const product = await getProductBySlug((await params).slug);
  if (!product) notFound();
  const available = product.variants.some((v) => v.isAvailable);
  return (
    <div className="container page">
      <nav aria-label={messages.product.breadcrumb} className={styles.breadcrumb}>
        <ol>
          <li>
            <Link href="/shop">{messages.nav.shopAll}</Link>
          </li>
          <li>
            <Link href={`/shop?category=${encodeURIComponent(product.categorySlug)}`}>{product.categoryTitle}</Link>
          </li>
          <li aria-current="page">{product.title}</li>
        </ol>
      </nav>
      <div className={styles.layout}>
        <ProductMedia url={product.images[0]?.url ?? null} alt={product.images[0]?.alt} title={product.title} large />
        <div className="stack-5">
          <div className="stack-2">
            <p className="label-text muted">{product.brand}</p>
            <h1 className={styles.title}>{product.title}</h1>
            {product.packSize ? <p className="muted">{product.packSize}</p> : null}
          </div>
          {product.isDemo ? <Notice tone="warning" title={messages.demo.productNotice} /> : null}
          {available ? (
            <ProductPurchase product={product} />
          ) : (
            <div className="stack-4">
              <Notice title={messages.product.outOfStock}>
                <p>{messages.product.unavailableBody}</p>
              </Notice>
              <ButtonLink href={`/shop?category=${encodeURIComponent(product.categorySlug)}`} variant="secondary">
                {format(messages.product.browseCategory, { category: product.categoryTitle })}
              </ButtonLink>
            </div>
          )}
          <p className="label-text muted">{messages.product.deliveryNote}</p>
          <details className={styles.details} open>
            <summary>{messages.product.details}</summary>
            <div className="stack-3 u-pt-3">
              <p>{product.description}</p>
              {product.packSize ? (
                <p>
                  <strong>{messages.product.packSize}:</strong> {product.packSize}
                </p>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
