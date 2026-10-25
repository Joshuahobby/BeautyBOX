import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./Notice.module.css";

type Tone = "info" | "success" | "warning" | "danger";

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle };

/**
 * Status notice: meaning always carried by words plus icon, never colour alone.
 * Green/success is reserved for verified completed events (DESIGN.md).
 */
export function Notice({
  tone = "info",
  title,
  children,
  actions,
  role,
  id,
  tabIndex,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  role?: "status" | "alert";
  id?: string;
  tabIndex?: number;
}) {
  const Icon = ICONS[tone];
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={role} id={id} tabIndex={tabIndex}>
      <Icon size={20} strokeWidth={2} aria-hidden="true" />
      <div>
        <p className={styles.title}>{title}</p>
        {children ? <div className={styles.body}>{children}</div> : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </div>
  );
}
