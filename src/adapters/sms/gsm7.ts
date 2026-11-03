// GSM 03.38 (GSM-7) text for SMS. A message written only in these characters costs one
// septet per character (two for the extension characters) and fits 160 characters in one
// part, 153 per part when split. A single character outside the set switches the whole
// message to UCS-2: 70 characters in one part, 67 per part. Pure functions, no server code.

const BASIC =
  "@£$¥èéùìòÇ\nØø\rÅå" +
  "Δ_ΦΓΛΩΠΨΣΘΞÆæßÉ" +
  " !\"#¤%&'()*+,-./" +
  "0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNO" +
  "PQRSTUVWXYZÄÖÑÜ§" +
  "¿abcdefghijklmno" +
  "pqrstuvwxyzäöñüà";
/** Reached through the escape code, so each costs two septets. */
const EXTENSION = "\f^{}\\[~]|€";

const BASIC_SET: ReadonlySet<string> = new Set(BASIC);
const EXTENSION_SET: ReadonlySet<string> = new Set(EXTENSION);

export const GSM7_SINGLE_PART = 160;
export const GSM7_PER_PART = 153;
export const UCS2_SINGLE_PART = 70;
export const UCS2_PER_PART = 67;

function septets(ch: string): 1 | 2 | null {
  if (BASIC_SET.has(ch)) return 1;
  if (EXTENSION_SET.has(ch)) return 2;
  return null;
}

/** True when every character can be sent in GSM-7 (no switch to UCS-2). */
export function isGsm7(text: string): boolean {
  for (const ch of text) if (septets(ch) === null) return false;
  return true;
}

/** Characters that would force UCS-2, in order of first appearance (for test messages). */
export function nonGsm7Characters(text: string): string[] {
  const found: string[] = [];
  for (const ch of text) if (septets(ch) === null && !found.includes(ch)) found.push(ch);
  return found;
}

export type SmsLength = { encoding: "GSM-7" | "UCS-2"; units: number; parts: number };

/**
 * Length in the units the network counts and the number of parts it is sent in. When split,
 * an extension character (two septets) or a UTF-16 surrogate pair is never cut between parts.
 */
export function smsLength(text: string): SmsLength {
  if (isGsm7(text)) {
    const costs = [...text].map((ch) => septets(ch)!);
    const units = costs.reduce<number>((a, b) => a + b, 0);
    return { encoding: "GSM-7", units, parts: units <= GSM7_SINGLE_PART ? 1 : splitParts(costs, GSM7_PER_PART) };
  }
  const costs = [...text].map((ch) => ch.length);
  const units = text.length;
  return { encoding: "UCS-2", units, parts: units <= UCS2_SINGLE_PART ? 1 : splitParts(costs, UCS2_PER_PART) };
}

function splitParts(costs: number[], perPart: number): number {
  let parts = 1;
  let used = 0;
  for (const cost of costs) {
    if (used + cost > perPart) {
      parts++;
      used = 0;
    }
    used += cost;
  }
  return parts;
}

// Look-alikes typed by staff or pasted from documents, mapped to plain GSM-7.
const REPLACEMENTS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "´": "'", "`": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"', "«": '"', "»": '"',
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
  "…": "...", "•": "-", "·": "-",
  "\t": " ", " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
  " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", "　": " ",
  "​": "", "‌": "", "‍": "", "⁠": "", "﻿": "",
};

/**
 * Returns the text in GSM-7 only, so one stray character (a curly quote, a non-breaking
 * space) cannot more than double the cost of a message. Look-alikes become their plain
 * forms, accented letters outside the set lose their accent, anything else becomes "?".
 */
export function toGsm7(text: string): string {
  let out = "";
  // Composed first, so "e" followed by a combining accent counts as "é" (which GSM-7 has).
  for (const ch of text.normalize("NFC")) {
    if (septets(ch) !== null) out += ch;
    else if (ch in REPLACEMENTS) out += REPLACEMENTS[ch];
    else if (/^\p{M}$/u.test(ch)) continue; // a stray combining mark adds nothing readable
    else {
      const bare = ch.normalize("NFD").replace(/\p{M}+/gu, "");
      out += bare.length > 0 && isGsm7(bare) ? bare : "?";
    }
  }
  return out;
}
