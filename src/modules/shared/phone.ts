import { parsePhoneNumberFromString } from "libphonenumber-js/max";

// Rwanda mobile numbers in canonical E.164 (+2507XXXXXXXX). Validation uses the
// maintained libphonenumber metadata for current mobile ranges rather than a
// hand-written prefix list, and never infers the wallet operator from the prefix.

export type PhoneResult = { ok: true; e164: string } | { ok: false };

export function normalizeRwandaMobile(input: string): PhoneResult {
  const trimmed = input.replace(/[\s().-]/g, "");
  if (trimmed.length === 0 || trimmed.length > 20) return { ok: false };
  const parsed = parsePhoneNumberFromString(trimmed, "RW");
  if (!parsed || parsed.country !== "RW" || !parsed.isValid()) return { ok: false };
  const type = parsed.getType();
  if (type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") return { ok: false };
  const e164 = parsed.number;
  if (!/^\+2507\d{8}$/.test(e164)) return { ok: false };
  return { ok: true, e164 };
}

/** `+250 7•• ••• 123` — enough for the customer to recognise their own number. */
export function maskPhone(e164: string): string {
  const last = e164.slice(-3);
  return `+250 7•• ••• ${last}`;
}

/** pawaPay MSISDN form: country code without "+". */
export function toMsisdn(e164: string): string {
  return e164.replace(/^\+/, "");
}
