import { formatRwf } from "@/modules/shared/money";

/** Authoritative integer RWF, tabular figures, `RWF 29,100` format. */
export function Money({ amount, className }: { amount: number; className?: string }) {
  return <span className={["tabular", className].filter(Boolean).join(" ")}>{formatRwf(amount)}</span>;
}
