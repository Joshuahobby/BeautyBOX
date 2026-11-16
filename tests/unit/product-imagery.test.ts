import { describe, expect, it } from "vitest";
import { productImage } from "@/lib/product-imagery";

const product = {
  slug: "lip-hue",
  title: "Lip Hue",
  isDemo: true,
  images: [] as { url: string; alt: string }[],
};

describe("reviewed photography versus generated demo imagery", () => {
  it("never substitutes generated artwork for a verified product with a matching demo slug", () => {
    expect(productImage({ ...product, isDemo: false })).toBeNull();
  });
  it("keeps reviewed SKU media authoritative even on a demonstration item", () => {
    const image = {
      url: "https://photos.example/product.webp",
      alt: "Reviewed pack shot",
    };
    expect(productImage({ ...product, images: [image] })).toEqual({
      ...image,
      illustrative: false,
    });
  });
  it("labels known demo artwork explicitly and leaves unknown images pending", () => {
    expect(productImage(product)).toMatchObject({
      illustrative: true,
      alt: "Illustrative image for Lip Hue",
    });
    expect(
      productImage({ ...product, slug: "unreviewed-future-product" }),
    ).toBeNull();
  });
});
