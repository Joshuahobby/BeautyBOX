// Prints each SMS template's length and number of parts (DR-048, DR-049), for reviewing wording
// (B09) and the cost per message. Uses realistic values: a 12-character order reference, the
// longest likely amount ("RWF 1,250,000"), the SMS link as sent (32 random bytes on /o#), a
// generic sender (before the sender ID is approved) or one that shows BeautyBOX, and no contact,
// the support phone or an e-mail. "Brand" says whether the text still opens with "BeautyBOX: "
// (it is left out only when the sender shows BeautyBOX and keeping it would cost a part);
// "Extra" says whether the optional help contact or PIN warning fitted at no extra cost.
//   npm run sms:lengths
import { smsLength } from "@/adapters/sms/gsm7";
import { BRAND_PREFIX, renderSms, SMS_TEMPLATES } from "@/modules/notifications/templates";

const ORIGINS = { production: "https://beautyboxmarket.com", staging: "https://staging.beautyboxmarket.com" } as const;
const TOKEN = "x".repeat(43); // base64url of 32 bytes
const CONTACTS = { none: null, phone: "+250788123456", "e-mail": "help@beautyboxmarket.com" } as const;

const rows: string[][] = [["Template", "Site", "Sender", "Contact", "Length", "Brand", "Extra"]];
for (const event of Object.keys(SMS_TEMPLATES)) {
  for (const [site, origin] of Object.entries(ORIGINS)) {
    for (const brandInSender of [false, true]) {
      for (const [label, contact] of Object.entries(CONTACTS)) {
        const text = renderSms(event, { reference: "BB-J2JS-KAWB", amount: "RWF 1,250,000", link: `${origin}/o#${TOKEN}`, contact, brandInSender })!;
        const l = smsLength(text);
        rows.push([
          event,
          site,
          brandInSender ? "BeautyBOX" : "generic",
          label,
          `${l.units}${l.encoding === "GSM-7" ? "" : ` ${l.encoding}`} (${l.parts} part${l.parts === 1 ? "" : "s"})`,
          text.startsWith(BRAND_PREFIX) ? "yes" : "dropped",
          / Help: | We never ask for your PIN\./.test(text) ? "yes" : "-",
        ]);
      }
    }
  }
}
const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
for (const row of rows) console.log(row.map((cell, i) => cell.padEnd(widths[i]!)).join("  "));
