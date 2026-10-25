import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import lockup from "@/design/brand/BeautyBox_Platform_Hub_Lockup.svg";
import { format, messages } from "@/messages";
import { serverEnv } from "@/server/env";
import { normalizeHost, safeNextPath } from "@/server/site-gate";
import { LaunchListForm } from "./LaunchListForm";
import styles from "../Launch.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: messages.launch.metaTitle, robots: { index: false, follow: false } };

// "Launching soon" (DR-044): what visitors without the access code see, at whatever address
// they asked for, and all the main domain shows before launch. The access link goes to the
// shop's own address, where the code is checked.
export default async function LaunchingSoonPage() {
  const env = serverEnv();
  const requestHeaders = await headers();
  const host = normalizeHost(requestHeaders.get("host") ?? "");
  const holding = env.HOLDING_HOSTS?.split(",").some((h) => normalizeHost(h) === host) ?? false;
  const requested = safeNextPath(requestHeaders.get("x-bb-requested-path"));
  const accessHref = holding ? `${env.APP_ORIGIN}/access` : requested === "/" ? "/access" : `/access?next=${encodeURIComponent(requested)}`;
  const contact = env.LAUNCH_LIST_CONTACT_EMAIL ?? null;

  return (
    <div className={styles.column}>
      <img src={lockup.src} alt={messages.brand.name} width={220} height={46} className={styles.lockup} decoding="async" fetchPriority="high" />
      <div className="stack-3">
        <p className={styles.eyebrow}>{messages.launch.eyebrow}</p>
        <h1 className={styles.heading}>{messages.launch.heading}</h1>
        <p className={styles.lede}>{messages.launch.lede}</p>
      </div>

      <section className={styles.panel} aria-labelledby="launch-list-heading">
        <h2 id="launch-list-heading" className={styles.panelHeading}>
          {messages.launch.listHeading}
        </h2>
        {env.LAUNCH_LIST === "open" && contact ? (
          <>
            <p className={styles.muted}>{messages.launch.listIntro}</p>
            <LaunchListForm removalNote={format(messages.launch.joinedRemoval, { email: contact })} />
          </>
        ) : (
          <p className={styles.muted}>{messages.launch.listClosed}</p>
        )}
      </section>

      <footer className={styles.footer}>
        {env.LAUNCH_LIST === "open" ? <Link href="/launch-privacy">{messages.launch.privacyLink}</Link> : null}
        {env.SITE_GATE === "on" ? (
          <span>
            {messages.launch.accessPrompt} <a href={accessHref}>{messages.launch.accessLink}</a>
          </span>
        ) : null}
      </footer>
    </div>
  );
}
