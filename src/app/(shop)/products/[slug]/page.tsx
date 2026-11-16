import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { messages } from "@/messages";
import { getProductBySlug } from "@/modules/catalog/catalog";
import { ProductExperience } from "./ProductExperience";
import styles from "./product.module.css";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const product = await getProductBySlug((await params).slug);
  return { title: product?.title ?? messages.errors.notFoundTitle };
}

// U03 / U03V / U04. Drafts and archived products 404 (CAT-01). No reviews, urgency or
// fabricated claims; description is the reviewed text stored for the product.
export default async function ProductPage({ params }: { params: Params }) {
  const product = await getProductBySlug((await params).slug);
  if (!product) notFound();
  return (
    <div className="container page">
      <nav
        aria-label={messages.product.breadcrumb}
        className={styles.breadcrumb}
      >
        <ol>
          <li>
            <Link href="/shop">{messages.nav.shopAll}</Link>
          </li>
          <li>
            <Link
              href={
                "/shop?category=" + encodeURIComponent(product.categorySlug)
              }
            >
              {product.categoryTitle}
            </Link>
          </li>
          <li aria-current="page">{product.title}</li>
        </ol>
      </nav>
      <ProductExperience product={product} />
    </div>
  );
}
