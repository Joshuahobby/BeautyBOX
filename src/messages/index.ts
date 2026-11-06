import { en } from "./en";

export const messages = en;

/** Fill `{name}` placeholders. Values must already be formatted (money, dates). */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  );
}

const kigaliTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Kigali",
  hour: "2-digit",
  minute: "2-digit",
});

const kigaliDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Kigali",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const kigaliYear = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kigali", year: "numeric" });

/** The year in Kigali at that moment (now by default), whatever time zone the server runs in. */
export function currentKigaliYear(at: Date = new Date()): string {
  return kigaliYear.format(at);
}

/** Operational times display in Africa/Kigali; records stay UTC. */
export function formatKigaliTime(iso: string | Date): string {
  return kigaliTime.format(new Date(iso));
}

export function formatKigaliDateTime(iso: string | Date): string {
  return `${kigaliDateTime.format(new Date(iso))} (Kigali)`;
}
