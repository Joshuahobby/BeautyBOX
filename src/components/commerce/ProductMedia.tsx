import { Package } from "lucide-react";
import { messages } from "@/messages";
import styles from "./Commerce.module.css";

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
}: {
  url: string | null;
  alt?: string;
  title: string;
  large?: boolean;
}) {
  if (url) {
    return (
      <div className={`${styles.media} ${large ? styles.mediaLarge : ""}`}>
        <img
          src={url}
          alt={alt ?? title}
          className={styles.mediaImg}
          loading="lazy"
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
