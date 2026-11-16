import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui/Notice";
import { messages } from "@/messages";
import { currentSettings } from "@/modules/settings/settings";
import { beautybox, helpTopics } from "@/content/beautybox";
import styles from "./help.module.css";

export const metadata: Metadata = { title: "Help" };
export const dynamic = "force-dynamic";

type SupportContact = { phone?: string; email?: string; hours?: string };

// U14: help topics and the approved support channel. Until the founder supplies the
// real contact (B05/B10) no number or address is shown; a fabricated one never is.
export default async function HelpPage() {
  const settings = await currentSettings().catch(() => null);
  const contact = (settings?.supportContact ?? null) as SupportContact | null;
  return (
    <div className="container page u-max-820">
      <div className="stack-5">
        <h1 className="page-title">{messages.support.heading}</h1>
        <section className="stack-3" aria-labelledby="topics">
          <h2 id="topics" className="section-title">
            {messages.support.topics}
          </h2>
          <ul className={styles.topicLinks}>
            {helpTopics.map((topic) => (
              <li key={topic.id}>
                <a href={`#${topic.id}`}>{topic.title}</a>
              </li>
            ))}
          </ul>
        </section>
        <section
          className={`stack-3 ${styles.contact}`}
          aria-labelledby="contact"
        >
          <h2 id="contact" className="section-title">
            {messages.support.contact}
          </h2>
          {contact && (contact.phone || contact.email) ? (
            <div className="stack-2">
              {contact.phone ? (
                <p>
                  <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                </p>
              ) : null}
              {contact.email ? (
                <p>
                  <a href={`mailto:${contact.email}`}>{contact.email}</a>
                </p>
              ) : null}
              {contact.hours ? <p className="muted">{contact.hours}</p> : null}
            </div>
          ) : (
            <Notice tone="warning" title={messages.support.contactPending} />
          )}
          <p className="label-text">{messages.support.safety}</p>
        </section>
        {helpTopics.map((topic) => (
          <section
            key={topic.id}
            id={topic.id}
            className={`stack-3 ${styles.topic}`}
            aria-labelledby={`${topic.id}-heading`}
          >
            <h2 id={`${topic.id}-heading`} className="section-title">
              {topic.title}
            </h2>
            {topic.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <Link href={topic.policy} className={styles.policyLink}>
              {topic.policyLabel}
            </Link>
          </section>
        ))}
        <section className="stack-3" aria-labelledby="help-location">
          <h2 id="help-location" className="section-title">
            {beautybox.locationHeading}
          </h2>
          <p>{beautybox.location}</p>
          <p>{beautybox.locationBody}</p>
        </section>
        <section className="stack-2" aria-labelledby="policies">
          <h2 id="policies" className="section-title">
            Policies
          </h2>
          <ul className="stack-2 u-indent">
            <li>
              <Link href="/help/delivery-returns">
                {messages.footer.deliveryReturns}
              </Link>
            </li>
            <li>
              <Link href="/help/terms">{messages.footer.terms}</Link>
            </li>
            <li>
              <Link href="/help/privacy">{messages.footer.privacy}</Link>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
