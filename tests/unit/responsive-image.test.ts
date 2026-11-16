import { describe, expect, it } from "vitest";
import { responsiveImage } from "@/lib/responsive-image";
import { productImage } from "@/lib/product-imagery";
describe("responsive image provenance", () => {
  it("derives source sets only for exact checked-in editorial assets", () => {
    expect(
      responsiveImage("/images/editorial/lip-hue.webp", "50vw").srcSet,
    ).toContain("lip-hue-480.webp 480w");
    for (const url of [
      "https://photos.example.test/product.webp",
      "/media/reviewed-photo.webp",
      "/images/editorial/unknown.webp",
      "/images/editorial/lip-hue.webp?changed=1",
    ])
      expect(responsiveImage(url, "50vw")).toEqual({});
  });
  it("preserves reviewed real SKU photos and never supplies a generated real-SKU fallback", () => {
    const base = {
      slug: "lip-hue",
      title: "Actual product",
      isDemo: false,
      images: [],
    };
    expect(productImage(base)).toBeNull();
    expect(
      productImage({
        ...base,
        images: [{ url: "/media/approved.webp", alt: "Reviewed product" }],
      }),
    ).toEqual({
      url: "/media/approved.webp",
      alt: "Reviewed product",
      illustrative: false,
    });
  });
});
