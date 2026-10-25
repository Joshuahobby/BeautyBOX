import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverEnv } from "@/server/env";
import { readDevsimInbox } from "@/adapters/sms/fake";
import { formatKigaliDateTime } from "@/messages";

export const metadata: Metadata = { title: "Simulated SMS inbox", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// LOCAL/TEST review aid only: shows what the fake SMS adapter "sent", so a reviewer can
// open private order links without a phone. Returns 404 in any other configuration.
export default async function DevSmsInboxPage() {
  const env = serverEnv();
  if ((env.APP_ENV !== "local" && env.APP_ENV !== "test") || env.SMS_PROVIDER !== "fake") notFound();
  const messages = await readDevsimInbox(50);
  const linkify = (text: string) =>
    text.split(/(https?:\/\/\S+?)(?=\.(?:\s|$)|\s|$)/).map((part, i) =>
      /^https?:\/\//.test(part) ? (
        <a key={i} href={part.replace(/^https?:\/\/[^/]+/, "")}>
          {part}
        </a>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  return (
    <main id="main" className="container page u-max-820">
      <div className="stack-4">
        <h1 className="page-title">Simulated SMS inbox</h1>
        <p className="muted">Local review only. Nothing here was sent to a phone. Each private link works once.</p>
        {messages.length === 0 ? (
          <p>No messages yet.</p>
        ) : (
          <ol className="stack-3 u-indent">
            {messages.map((m) => (
              <li key={m.id}>
                <p className="label-text muted">
                  {formatKigaliDateTime(m.createdAt)} · to {m.recipient} · {m.outcome.toLowerCase()}
                </p>
                <p className="u-break-word">{linkify(m.body)}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
