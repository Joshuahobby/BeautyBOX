import { Package } from "lucide-react";
import { messages } from "@/messages";
import styles from "./Commerce.module.css";

/**
 * Reviewed product photography only. Until real SKU images exist (founder input B02)
 * the slot says so plainly instead of showing generated or retailer imagery.
 */
export function ProductMedia({ url, alt, title, large }: { url: string | null; alt?: string; title: string; large?: boolean }) {
  if (url) {
    return (
      <div className={`${styles.media} ${large ? styles.mediaLarge : ""}`}>
        <img src={url} alt={alt ?? title} className={styles.mediaImg} loading="lazy" decoding="async" />
      </div>
    );
  }
  return (
    <div className={`${styles.media} ${large ? styles.mediaLarge : ""}`} role="img" aria-label={`${messages.demo.photoPending}: ${title}`}>
      <Package size={large ? 48 : 32} strokeWidth={1.75} aria-hidden="true" />
      <span className={styles.mediaText} aria-hidden="true">
        {messages.demo.photoPending}
      </span>
    </div>
  );
}
