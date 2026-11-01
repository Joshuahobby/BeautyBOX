// Prints each SMS template's length and number of parts (DR-048), for reviewing wording (B09)
// and the cost per message. Uses realistic values: a 12-character order reference, a six-figure
// amount, the private link as the app builds it today (32 random bytes in the fragment), and
// with and without the support phone number. The last column shows the proposed shorter link
// (16 random bytes on a one-letter path), which is not built.
//   npm run sms:lengths
import { smsLength, type SmsLength } from "@/adapters/sms/gsm7";
import { SMS_TEMPLATES, renderSms } from "@/modules/notifications/templates";

const ORIGINS = { production: "https://beautyboxmarket.com", staging: "https://staging.beautyboxmarket.com" } as const;
const CURRENT_TOKEN = "x".repeat(43); // base64url of 32 bytes
const SHORT_TOKEN = "x".repeat(22); // base64url of 16 bytes
const currentLink = (origin: string) => `${origin}/order-access#token=${CURRENT_TOKEN}`;
const shortLink = (origin: string) => `${origin}/o#${SHORT_TOKEN}`;

const show = (l: SmsLength) => `${l.units} ${l.encoding === "GSM-7" ? "" : `${l.encoding} `}(${l.parts} part${l.parts === 1 ? "" : "s"})`;

const rows: string[][] = [["Template", "Site", "Help contact", "Now", "Short link (proposal)"]];
for (const event of Object.keys(SMS_TEMPLATES)) {
  for (const [site, origin] of Object.entries(ORIGINS)) {
    for (const contact of [null, "+250788123456"]) {
      const input = { reference: "BB-J2JS-KAWB", amount: "RWF 129,100", contact };
      const now = renderSms(event, { ...input, link: currentLink(origin) })!;
      const short = renderSms(event, { ...input, link: shortLink(origin) })!;
      const needsLink = SMS_TEMPLATES[event as keyof typeof SMS_TEMPLATES].needsLink;
      rows.push([event, site, contact ? "phone" : "none", show(smsLength(now)), needsLink ? show(smsLength(short)) : "(no link)"]);
    }
  }
}
const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
for (const row of rows) console.log(row.map((cell, i) => cell.padEnd(widths[i]!)).join("  "));
