import type { Metadata } from "next";
import { LAUNCH_PRIVACY } from "@/content/launch-privacy";
import { messages } from "@/messages";
import { serverEnv } from "@/server/env";
import styles from "../Launch.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: LAUNCH_PRIVACY.title, robots: { index: false, follow: false } };

// Privacy notice for the launch e-mail list (DR-045), reachable from the main domain before launch.
export default function LaunchPrivacyPage() {
  const contact = serverEnv().LAUNCH_LIST_CONTACT_EMAIL ?? "the contact address shown when the list opens";
  return (
    <div className={styles.column}>
      <article className={styles.article}>
        <div className="stack-3">
          <h1 className={styles.heading}>{LAUNCH_PRIVACY.title}</h1>
          <p className={styles.muted}>Last updated {LAUNCH_PRIVACY.updated}</p>
        </div>
        {LAUNCH_PRIVACY.sections.map((section) => (
          <section key={section.heading} className="stack-3">
            <h2>{section.heading}</h2>
            {section.paragraphs.map((p) => (
              <p key={p.slice(0, 40)}>{p.replaceAll("{contact}", contact)}</p>
            ))}
          </section>
        ))}
      </article>
      <footer className={styles.footer}>
        <a href="/launching-soon">{messages.access.back}</a>
      </footer>
    </div>
  );
}
