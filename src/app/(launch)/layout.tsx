import { messages } from "@/messages";
import styles from "./Launch.module.css";

export const dynamic = "force-dynamic";

// Pre-launch pages (DR-044): no shop header, cart or demo banner, so nothing of the closed
// shop shows to visitors without the access code.
export default function LaunchLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <a href="#main" className="skip-link">
        {messages.nav.skipToContent}
      </a>
      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
    </div>
  );
}
