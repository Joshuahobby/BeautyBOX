import { Package } from "lucide-react";
import { messages } from "@/messages";
import styles from "./Commerce.module.css";
import { responsiveImage } from "@/lib/responsive-image";

/**
 * Render the image explicitly selected by the caller. Real SKUs use reviewed photos;
 * productImage() may supply labelled generated artwork for DEMO products only.
 * Missing media remains visibly pending rather than showing an unrelated product.
 */
export function ProductMedia({
  url,
  alt,
  title,
  large,
  sizes,
}: {
  url: string | null;
  alt?: string;
  title: string;
  large?: boolean;
  sizes?: string;
}) {
  if (url) {
    return (
      <div className={`${styles.media} ${large ? styles.mediaLarge : ""}`}>
        <img
          src={url}
          alt={alt ?? title}
          className={styles.mediaImg}
          width={800}
          height={800}
          {...responsiveImage(
            url,
            sizes ??
              (large
                ? "(max-width: 767px) calc(100vw - 32px), (max-width: 1264px) calc((100vw - 112px) * .56), 645px"
                : "(max-width: 340px) calc(100vw - 32px), (max-width: 767px) calc((100vw - 48px) / 2), (max-width: 1023px) calc((100vw - 112px) / 3), (max-width: 1264px) calc((100vw - 136px) / 4), 282px"),
          )}
          loading={large ? "eager" : "lazy"}
          fetchPriority={large ? "high" : "auto"}
          decoding="async"
        />
      </div>
    );
  }
  return (
    <div
      className={`${styles.media} ${large ? styles.mediaLarge : ""}`}
      role="img"
      aria-label={`${messages.demo.photoPending}: ${title}`}
    >
      <Package size={large ? 48 : 32} strokeWidth={1.75} aria-hidden="true" />
      <span className={styles.mediaText} aria-hidden="true">
        {messages.demo.photoPending}
      </span>
    </div>
  );
}
