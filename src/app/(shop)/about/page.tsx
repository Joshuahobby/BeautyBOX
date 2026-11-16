import type { Metadata } from "next";
import Link from "next/link";
import { beautybox } from "@/content/beautybox";

export const metadata: Metadata = {
  title: "About BeautyBOX",
  description:
    "Meet BeautyBOX, a beauty and personal-care shop in Kigali with guest checkout and delivery totals shown before you pay.",
};

export default function AboutPage() {
  return (
    <div className="container page u-max-820">
      <article className="stack-6">
        <div className="stack-4">
          <h1 className="page-title">{beautybox.aboutTitle}</h1>
          <p className="section-title">{beautybox.headline}</p>
          <p>{beautybox.intro}</p>
        </div>
        {beautybox.principles.map((item) => (
          <section key={item.heading} className="stack-3">
            <h2 className="section-title">{item.heading}</h2>
            <p>{item.body}</p>
          </section>
        ))}
        <section className="stack-3" aria-labelledby="shop-location">
          <h2 id="shop-location" className="section-title">
            {beautybox.locationHeading}
          </h2>
          <p>{beautybox.location}</p>
          <p>{beautybox.locationBody}</p>
        </section>
        <nav aria-label="Next steps" className="u-flex-wrap-3">
          <Link href="/shop">Explore the shop</Link>
          <Link href="/help">Visit our help centre</Link>
          <Link href="/help/delivery-returns">Delivery and returns</Link>
        </nav>
      </article>
    </div>
  );
}
