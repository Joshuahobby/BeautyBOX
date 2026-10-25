import Link from "next/link";
import { messages } from "@/messages";
import styles from "./Layout.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.footerInner}`}>
        <nav aria-label="Help and policies">
          <ul className={styles.footerLinks}>
            <li>
              <Link href="/help">{messages.footer.help}</Link>
            </li>
            <li>
              <Link href="/help/delivery-returns">{messages.footer.deliveryReturns}</Link>
            </li>
            <li>
              <Link href="/help/terms">{messages.footer.terms}</Link>
            </li>
            <li>
              <Link href="/help/privacy">{messages.footer.privacy}</Link>
            </li>
          </ul>
        </nav>
        <p className="label-text muted">{messages.footer.note}</p>
      </div>
    </footer>
  );
}

export function DemoBanner() {
  return (
    <div className={styles.demoBanner} role="note">
      <div className="container">{messages.demo.banner}</div>
    </div>
  );
}
