import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "accent" | "quiet";

type Common = { variant?: Variant; full?: boolean; busy?: boolean; busyLabel?: string; children: ReactNode; className?: string };

function classes({ variant = "primary", full, busy, className }: Omit<Common, "children">) {
  return [styles.button, styles[variant], full ? styles.full : "", busy ? styles.busy : "", className ?? ""].filter(Boolean).join(" ");
}

/** 48 px control; a busy button keeps its size and announces what is happening. */
export function Button({
  variant,
  full,
  busy,
  busyLabel,
  children,
  className,
  disabled,
  type = "button",
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={classes({ variant, full, busy, className })}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className={styles.spinner} aria-hidden="true" /> : null}
      <span>{busy && busyLabel ? busyLabel : children}</span>
    </button>
  );
}

export function ButtonLink({ href, variant, full, children, className }: Common & { href: string }) {
  return (
    <Link href={href} className={classes({ variant, full, className })}>
      {children}
    </Link>
  );
}
