import type { Metadata } from "next";
import { messages } from "@/messages";
import { safeNextPath } from "@/server/site-gate";
import { BrandStage, Eyebrow, Headline, LaunchFrame } from "../LaunchParts";
import { AccessForm } from "./AccessForm";
import styles from "../Launch.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: messages.access.metaTitle, robots: { index: false, follow: false } };

type SearchParams = Promise<{ next?: string | string[] }>;

// Pre-launch access code (DR-044). The code is checked on the server; a correct one sets a
// cookie for 30 days and returns the visitor to the page they asked for.
export default async function AccessPage({ searchParams }: { searchParams: SearchParams }) {
  const next = (await searchParams).next;
  const t = messages.access;
  return (
    <LaunchFrame linkHome footer={<a href="/launching-soon">{t.back}</a>}>
      <section className={styles.hero} aria-labelledby="access-heading">
        <div className={styles.copy}>
          <Eyebrow>{t.eyebrow}</Eyebrow>
          <Headline id="access-heading">{t.heading}</Headline>
          <p className={styles.lede}>{t.intro}</p>
          <div className={styles.card}>
            <AccessForm next={safeNextPath(Array.isArray(next) ? next[0] : next)} />
          </div>
        </div>

        <BrandStage />
      </section>
    </LaunchFrame>
  );
}
