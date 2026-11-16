import manifest from "./responsive-images.json";
type ImageInfo = {
  width: number;
  height: number;
  variants: { url: string; width: number }[];
};
/** Exact local allowlist only. Reviewed uploads retain their original URLs. */
export function responsiveImage(url: string, sizes: string) {
  const info = (manifest.images as Record<string, ImageInfo>)[url];
  return info
    ? {
        width: info.width,
        height: info.height,
        sizes,
        srcSet: [
          ...info.variants.map((v) => `${v.url} ${v.width}w`),
          `${url} ${info.width}w`,
        ].join(", "),
      }
    : {};
}
