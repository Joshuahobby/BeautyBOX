"use client";
import { useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { Button } from "./Button";
import styles from "./PageFeedback.module.css";

/** Retry re-fetches route reads. Event handlers, mutations and payments are never replayed. */
export function PageRecovery({
  retry,
  staff = false,
}: {
  retry: () => void;
  staff?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => heading.current?.focus(), []);
  return (
    <section
      className={`${staff ? "" : "container "}${styles.feedback}`}
      aria-labelledby="page-recovery-title"
    >
      <h1
        id="page-recovery-title"
        className="page-title"
        tabIndex={-1}
        ref={heading}
      >
        We couldn’t load this page
      </h1>
      <p>Try loading it again. Your navigation is still available.</p>
      <div>
        <Button onClick={() => startTransition(() => retry())} busy={pending}>
          Try loading again
        </Button>
      </div>
      <p>
        <Link href={staff ? "/staff" : "/shop"}>
          {staff ? "Back to workspace" : "Back to shop"}
        </Link>
      </p>
    </section>
  );
}
