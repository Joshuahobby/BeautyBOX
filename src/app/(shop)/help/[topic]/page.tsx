import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/ui/Notice";
import { POLICIES, type PolicyTopic } from "@/content/policies";
import { messages } from "@/messages";
import { currentSettings } from "@/modules/settings/settings";
import { serverEnv } from "@/server/env";

export const dynamic = "force-dynamic";

type Params = Promise<{ topic: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const policy = POLICIES[(await params).topic as PolicyTopic];
  return { title: policy?.title ?? messages.errors.notFoundTitle };
}

// U15: policies. Drafts are clearly labelled outside production; in production an
// unapproved policy is not presented as published (checkout stays closed anyway).
export default async function PolicyPage({ params }: { params: Params }) {
  const topic = (await params).topic as PolicyTopic;
  const policy = POLICIES[topic];
  if (!policy) notFound();
  const settings = await currentSettings().catch(() => null);
  const approved = settings?.policiesApproved === true;
  const production = serverEnv().APP_ENV === "production";

  return (
    <div className="container page u-max-712">
      <article className="stack-5">
        <h1 className="page-title">{policy.title}</h1>
        {!approved && production ? (
          <Notice title="This policy is being finalised and will be published before ordering opens." />
        ) : (
          <>
            {!approved ? <Notice tone="warning" title={messages.demo.draftPolicy} /> : null}
            {policy.sections.map((section) => (
              <section key={section.heading} className="stack-3">
                <h2 className="section-title">{section.heading}</h2>
                {section.paragraphs.map((p) => (
                  <p key={p.slice(0, 40)}>{p}</p>
                ))}
              </section>
            ))}
          </>
        )}
      </article>
    </div>
  );
}
