import type { PublicProduct } from "@/modules/catalog/catalog";

// Generated demonstration assets never stand in for reviewed photography on a real SKU.
const demoImages: Record<string, string> = {
  "pure-zen-cleanser": "cleanser",
  "lip-hue": "lip-hue",
  "makeup-bag": "makeup-bag",
  "radishield-sun-cream": "sun-cream",
  "makeup-sponge-pair": "makeup-sponges",
  "detangling-comb": "detangling-comb",
  "gloss-clear": "clear-gloss",
  "brow-pencil": "brow-pencil",
  "citrus-shower-gel": "citrus-shower-gel",
  "clay-face-mask": "clay-mask",
  "eternal-matteblend-foundation": "foundation",
  "mascara-twinkle-lengthen": "mascara",
  "ember-perfume": "perfume",
  "rosewhisper-perspirant-roll-on": "roll-on",
};
export function productImage(
  product: Pick<PublicProduct, "images" | "isDemo" | "slug" | "title">,
) {
  const reviewed = product.images[0];
  if (reviewed) return { ...reviewed, illustrative: false };
  const asset = product.isDemo ? demoImages[product.slug] : undefined;
  return asset
    ? {
        url: "/images/editorial/" + asset + ".webp",
        alt: "Illustrative image for " + product.title,
        illustrative: true,
      }
    : null;
}
