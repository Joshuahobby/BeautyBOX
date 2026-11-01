import { toGsm7 } from "@/adapters/sms/gsm7";
import type { NotificationEvent } from "./intents";

// Transactional SMS wording (I11). Follows business/Policy-and-Copy-Drafts.md; drafts until
// approved (B09). Written in plain GSM-7 only (straight quotes, no dashes or ellipses), so a
// message is never switched to the costlier UCS-2 encoding; `tests/unit/sms-templates.test.ts`
// checks that and records each template's length in parts. Pure: no database or server code.

export type SmsTemplateInput = {
  reference: string;
  /** Already formatted, e.g. "RWF 29,100". */
  amount: string;
  /** The private order link, for templates that carry one. */
  link: string | null;
  /** Support phone or e-mail from the settings, if set. */
  contact: string | null;
};

type Template = { needsLink: boolean; text: (v: SmsTemplateInput & { help: string }) => string };

export const SMS_TEMPLATES: Record<NotificationEvent, Template> = {
  ORDER_CONFIRMED: { needsLink: true, text: (v) => `BeautyBOX: Payment received for order ${v.reference}, ${v.amount}. View your order: ${v.link}.${v.help}` },
  ORDER_DISPATCHED: { needsLink: true, text: (v) => `BeautyBOX: Order ${v.reference} has been handed to our delivery partner. View status: ${v.link}.${v.help}` },
  ORDER_ON_HOLD: { needsLink: false, text: (v) => `BeautyBOX: We need to contact you about order ${v.reference}.${v.contact ? ` Please contact ${v.contact}.` : ""}` },
  DELIVERY_PROBLEM: { needsLink: false, text: (v) => `BeautyBOX: We need to contact you about order ${v.reference}.${v.contact ? ` Please contact ${v.contact}.` : ""}` },
  REFUND_CONFIRMED: { needsLink: false, text: (v) => `BeautyBOX: Your refund of ${v.amount} for order ${v.reference} is confirmed.${v.help}` },
  // Not in the copy drafts: a reviewed wording is needed before launch (see PROGRESS).
  ACCESS_LINK: { needsLink: true, text: (v) => `BeautyBOX: Your new private link for order ${v.reference}: ${v.link}. It works once and expires in 7 days.${v.help}` },
};

export function smsTemplate(event: string): Template | null {
  return Object.hasOwn(SMS_TEMPLATES, event) ? SMS_TEMPLATES[event as NotificationEvent] : null;
}

/**
 * The message as sent. Values typed by staff (the support contact) may hold characters outside
 * GSM-7, such as a curly quote; those are replaced so one character cannot double the cost.
 */
export function renderSms(event: string, input: SmsTemplateInput): string | null {
  const template = smsTemplate(event);
  if (!template) return null;
  return toGsm7(template.text({ ...input, help: input.contact ? ` Help: ${input.contact}.` : "" }));
}
