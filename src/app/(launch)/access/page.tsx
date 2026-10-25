import type { Metadata } from "next";
import lockup from "@/design/brand/BeautyBox_Platform_Hub_Lockup.svg";
import { messages } from "@/messages";
import { safeNextPath } from "@/server/site-gate";
import { AccessForm } from "./AccessForm";
import styles from "../Launch.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: messages.access.metaTitle, robots: { index: false, follow: false } };

type SearchParams = Promise<{ next?: string | string[] }>;

// Pre-launch access code (DR-044). The code is checked on the server; a correct one sets a
// cookie for 30 days and returns the visitor to the page they asked for.
export default async function AccessPage({ searchParams }: { searchParams: SearchParams }) {
  const next = (await searchParams).next;
  return (
    <div className={styles.column}>
      <img src={lockup.src} alt={messages.brand.name} width={220} height={46} className={styles.lockup} decoding="async" />
      <div className="stack-3">
        <h1 className={styles.heading}>{messages.access.heading}</h1>
        <p className={styles.lede}>{messages.access.intro}</p>
      </div>
      <section className={styles.panel} aria-label={messages.access.heading}>
        <AccessForm next={safeNextPath(Array.isArray(next) ? next[0] : next)} />
      </section>
      <footer className={styles.footer}>
        <a href="/launching-soon">{messages.access.back}</a>
      </footer>
    </div>
  );
}
