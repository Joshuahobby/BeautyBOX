import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ReceiptText, ShoppingBag, Smartphone, Truck } from "lucide-react";
import { format, messages } from "@/messages";
import { serverEnv } from "@/server/env";
import { normalizeHost, safeNextPath } from "@/server/site-gate";
import { BrandStage, Eyebrow, Headline, LaunchFrame } from "../LaunchParts";
import { LaunchListForm } from "./LaunchListForm";
import styles from "../Launch.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: messages.launch.metaTitle, robots: { index: false, follow: false } };

const POINT_ICONS = { delivery: Truck, guest: ShoppingBag, momo: Smartphone, total: ReceiptText } as const;

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
  const listOpen = env.LAUNCH_LIST === "open" && contact !== null;
  const t = messages.launch;

  return (
    <LaunchFrame
      footer={
        <>
          {listOpen ? <Link href="/launch-privacy">{t.privacyLink}</Link> : null}
          {env.SITE_GATE === "on" ? (
            <span>
              {t.accessPrompt} <a href={accessHref}>{t.accessLink}</a>
            </span>
          ) : null}
        </>
      }
    >
      <section className={styles.hero} aria-labelledby="launch-heading">
        <div className={styles.copy}>
          <Eyebrow>{t.eyebrow}</Eyebrow>
          <Headline id="launch-heading">{t.heading}</Headline>
          <p className={styles.lede}>{t.lede}</p>

          <section className={styles.card} aria-labelledby="launch-list-heading">
            {listOpen ? (
              <>
                <h2 id="launch-list-heading" className={styles.cardHeading}>
                  {t.listHeading}
                </h2>
                <p className={styles.muted}>{t.listIntro}</p>
                <LaunchListForm removalNote={format(t.joinedRemoval, { email: contact })} />
              </>
            ) : (
              <>
                <span className={styles.closedRule} aria-hidden="true" />
                <h2 id="launch-list-heading" className={styles.cardHeading}>
                  {t.listClosedHeading}
                </h2>
                <p className={styles.muted}>{t.listClosed}</p>
              </>
            )}
          </section>
        </div>

        <BrandStage />
      </section>

      <section className={styles.expect} aria-labelledby="launch-points-heading">
        <h2 id="launch-points-heading" className={styles.expectLabel}>
          {t.pointsLabel}
        </h2>
        <ul className={styles.points}>
          {t.points.map((point) => {
            const Icon = POINT_ICONS[point.id];
            return (
              <li key={point.id} className={styles.point}>
                <span className={styles.pointIcon} aria-hidden="true">
                  <Icon size={20} strokeWidth={1.75} />
                </span>
                <p className={styles.pointTitle}>{point.title}</p>
                <p className={styles.pointText}>{point.text}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </LaunchFrame>
  );
}
