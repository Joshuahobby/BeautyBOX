// Money is whole RWF held as integers. Database columns are BIGINT; values cross the
// API boundary as JSON numbers only after a safe-integer check.

export const CURRENCY = "RWF" as const;
export type Currency = typeof CURRENCY;

export function toRwf(value: bigint | number): number {
  const n = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError("RWF amounts must be non-negative safe integers");
  }
  if (typeof value === "bigint" && BigInt(n) !== value) {
    throw new RangeError("RWF amount outside safe integer range");
  }
  return n;
}

export function sumRwf(values: readonly number[]): number {
  let total = 0n;
  for (const v of values) total += BigInt(toRwf(v));
  return toRwf(total);
}

export function multiplyRwf(unit: number, quantity: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new RangeError("quantity must be a whole number");
  return toRwf(BigInt(toRwf(unit)) * BigInt(quantity));
}

const grouping = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, useGrouping: true });

/** Display format mandated by DESIGN.md: `RWF 29,100`, never decimals. */
export function formatRwf(amount: number): string {
  return `RWF ${grouping.format(toRwf(amount))}`;
}
