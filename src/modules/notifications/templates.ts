import { smsLength, toGsm7 } from "@/adapters/sms/gsm7";
import type { NotificationEvent } from "./intents";

// Transactional SMS wording (I11, DR-048, DR-049). Written to cost one SMS part (160 GSM-7
// characters) in production, at the founder's request (2026-11-01); final sign-off with the
// other copy (B09). Rules that keep the cost down:
// - Plain GSM-7 only (straight quotes, no dashes or ellipses), so a message never switches to
//   UCS-2; the rendered text also passes through a GSM-7 cleaner (staff-typed contact).
// - The private link is the short SMS form (/o#<token>, 32 random bytes) and always comes LAST, with
//   nothing after it: a phone may glue trailing punctuation onto a link.
// - "BeautyBOX: " opens every message (who is writing, even when forwarded) unless the sender
//   already shows BeautyBOX AND keeping it would cost an extra part.
// - Optional extras (the help contact, the PIN warning) are added only where they cost no extra
//   part; the order page shows the help contact anyway.
// `tests/unit/sms-templates.test.ts` holds every template to one part in the worst realistic case
// (support phone, or an e-mail of up to 60 characters).
// Pure: no database or server code.

export type SmsTemplateInput = {
  reference: string;
  /** Already formatted, e.g. "RWF 29,100". */
  amount: string;
  /** The private order link, for templates that carry one. */
  link: string | null;
  /** Support phone or e-mail from the settings, if set. */
  contact: string | null;
  /** The sender shows as BeautyBOX (approved sender ID): the prefix may go if keeping it costs a part. */
  brandInSender: boolean;
};

/**
 * Placeholders: {brand} {ref} {amount} {link} {contact} {extra}. `extraText` fills {extra} only
 * where it adds no SMS part (and, if it names {contact}, only when a contact is set).
 * `noContactText` replaces `text` when no support contact is set.
 */
export type SmsTemplate = { needsLink: boolean; text: string; extraText: string; noContactText?: string };

export const BRAND_PREFIX = "BeautyBOX: ";

// Wording chosen on 2026-11-01 by a panel of three drafts (lowest cost, clarity for
// second-language readers, trust) and a judge who re-counted every length (DR-049).
// Worst case in production (brand prefix, "RWF 1,250,000", 52-character link): every message
// is one part with the support phone; ACCESS_LINK drops a long e-mail contact to stay at one.
export const SMS_TEMPLATES: Record<NotificationEvent, SmsTemplate> = {
  ORDER_CONFIRMED: { needsLink: true, text: "{brand}Order {ref} is paid: {amount}.{extra} See your order: {link}", extraText: " Help: {contact}." },
  // Past tense: true even when staff record the handover after the fact (DR-049 review).
  ORDER_DISPATCHED: { needsLink: true, text: "{brand}Order {ref} has been handed to our rider.{extra} See your order: {link}", extraText: " Help: {contact}." },
  // No reason is given. "Talk with you" so "contact" is not used twice with two meanings.
  ORDER_ON_HOLD: {
    needsLink: false,
    text: "{brand}We need to talk with you about order {ref}. Please contact us at {contact}.{extra}",
    noContactText: "{brand}We need to talk with you about order {ref}. We will contact you.{extra}",
    extraText: " We never ask for your PIN.",
  },
  // Not "we could not deliver": that is the wording of a common fake-parcel scam.
  DELIVERY_PROBLEM: {
    needsLink: false,
    text: "{brand}We need to talk with you about the delivery of order {ref}. Please contact us at {contact}.{extra}",
    noContactText: "{brand}We need to talk with you about the delivery of order {ref}. We will contact you.{extra}",
    extraText: " We never ask for your PIN.",
  },
  // The SMS goes to the order's contact, who may not be the person who paid.
  REFUND_CONFIRMED: { needsLink: false, text: "{brand}Your refund of {amount} for order {ref} is confirmed. It goes back to the number used for payment.{extra}", extraText: " Help: {contact}." },
  // Not in the copy drafts. "Do not share it": forwarding the link before opening it locks the customer out.
  ACCESS_LINK: { needsLink: true, text: "{brand}New link for order {ref}. Do not share it.{extra} Use once, within 7 days: {link}", extraText: " Help: {contact}." },
};

export function smsTemplate(event: string): SmsTemplate | null {
  return Object.hasOwn(SMS_TEMPLATES, event) ? SMS_TEMPLATES[event as NotificationEvent] : null;
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(brand|ref|amount|link|contact|extra)\}/g, (_, key: string) => values[key] ?? "");
}

/**
 * The message as sent, in GSM-7 only: the fewest parts possible, and among those the most
 * informative version. The brand can be dropped only when the sender already shows BeautyBOX.
 * With a link (whose address names BeautyBOX) the extra outranks the brand; without a link the
 * brand outranks the extra, because nothing else in the text says who is writing.
 */
export function renderSms(event: string, input: SmsTemplateInput): string | null {
  const template = smsTemplate(event);
  if (!template) return null;
  const values = { ref: input.reference, amount: input.amount, link: input.link ?? "", contact: input.contact ?? "" };
  const body = !input.contact && template.noContactText ? template.noContactText : template.text;
  const extraAllowed = Boolean(template.extraText) && !(template.extraText.includes("{contact}") && !input.contact);
  const second = template.needsLink ? { brand: false, extra: true } : { brand: true, extra: false };
  const third = template.needsLink ? { brand: true, extra: false } : { brand: false, extra: true };
  const choices = [{ brand: true, extra: true }, second, third, { brand: false, extra: false }].filter(
    (c) => (c.brand || input.brandInSender) && (!c.extra || extraAllowed),
  );
  const texts = choices.map((c) => toGsm7(fill(body, { ...values, brand: c.brand ? BRAND_PREFIX : "", extra: c.extra ? fill(template.extraText, values) : "" })));
  const fewest = Math.min(...texts.map((t) => smsLength(t).parts));
  return texts.find((t) => smsLength(t).parts === fewest)!;
}
