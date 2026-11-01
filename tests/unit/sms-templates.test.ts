import { describe, expect, it } from "vitest";
import { nonGsm7Characters, smsLength } from "@/adapters/sms/gsm7";
import { BRAND_PREFIX, renderSms, SMS_TEMPLATES } from "@/modules/notifications/templates";
import { smsDeliveryLabel } from "@/components/staff/labels";

// DR-048, DR-049: every template is plain GSM-7 and costs ONE SMS part in production in every
// realistic worst case; the private link always comes last; "BeautyBOX: " opens every message
// unless the sender already shows BeautyBOX and keeping it would cost a part (or, for messages
// with a link, the help contact); optional extras are added only where they cost no extra part.
// `npm run sms:lengths` prints the full table.

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"; // 32 random bytes, base64url
const ORIGINS = { production: "https://beautyboxmarket.com", staging: "https://staging.beautyboxmarket.com" };
// No contact, the support phone, a typical e-mail, and the longest e-mail that keeps every
// message at one part (60 characters, set by the delivery-problem message).
const LONGEST_EMAIL = `${"a".repeat(55)}@b.rw`;
const CONTACTS = [null, "+250788123456", "help@beautyboxmarket.com", LONGEST_EMAIL];
const worst = { reference: "BB-J2JS-KAWB", amount: "RWF 1,250,000" };
const events = Object.keys(SMS_TEMPLATES) as (keyof typeof SMS_TEMPLATES)[];
const withLink = events.filter((e) => SMS_TEMPLATES[e].needsLink);
const withoutLink = events.filter((e) => !SMS_TEMPLATES[e].needsLink);

const render = (event: string, o: { origin?: string; contact?: string | null; brandInSender?: boolean; amount?: string } = {}) =>
  renderSms(event, {
    reference: worst.reference,
    amount: o.amount ?? worst.amount,
    link: SMS_TEMPLATES[event as keyof typeof SMS_TEMPLATES].needsLink ? `${o.origin ?? ORIGINS.production}/o#${TOKEN}` : null,
    contact: o.contact === undefined ? "+250788123456" : o.contact,
    brandInSender: o.brandInSender ?? false,
  })!;

describe("SMS templates", () => {
  it("are written in GSM-7 only, every variant and extra", () => {
    expect(TOKEN).toHaveLength(43);
    for (const event of events) {
      const t = SMS_TEMPLATES[event];
      for (const part of [t.text, t.extraText, t.noContactText ?? ""]) expect(nonGsm7Characters(part), `${event}: ${part}`).toEqual([]);
    }
  });

  it("cost one part in production, whatever the sender, with no contact, the phone or an e-mail of up to 60 characters", () => {
    expect(LONGEST_EMAIL).toHaveLength(60);
    for (const event of events) {
      for (const brandInSender of [false, true]) {
        for (const contact of CONTACTS) {
          const text = render(event, { contact, brandInSender });
          expect(smsLength(text), `${event} brandInSender=${brandInSender} contact=${contact}: ${text}`).toMatchObject({ encoding: "GSM-7", parts: 1 });
        }
      }
    }
  });

  it("cost one part on staging too, except the new-link message from a generic sender (staging's address is 8 characters longer; sandbox messages are free)", () => {
    for (const event of events) {
      for (const brandInSender of [false, true]) {
        for (const contact of CONTACTS) {
          const text = render(event, { origin: ORIGINS.staging, contact, brandInSender });
          const expected = event === "ACCESS_LINK" && !brandInSender ? 2 : 1;
          expect(smsLength(text).parts, `${event} brandInSender=${brandInSender} contact=${contact}`).toBe(expected);
        }
      }
    }
  });

  it("end with the private link, with nothing after it", () => {
    for (const event of withLink) expect(render(event).endsWith(`/o#${TOKEN}`), event).toBe(true);
  });

  it("read as intended for an order confirmation and a handover (past tense, true if recorded late)", () => {
    expect(render("ORDER_CONFIRMED", { amount: "RWF 29,100" })).toBe(`BeautyBOX: Order BB-J2JS-KAWB is paid: RWF 29,100. See your order: https://beautyboxmarket.com/o#${TOKEN}`);
    expect(render("ORDER_DISPATCHED", { contact: null })).toBe(`BeautyBOX: Order BB-J2JS-KAWB has been handed to our rider. See your order: https://beautyboxmarket.com/o#${TOKEN}`);
  });

  it("always name BeautyBOX in messages without a link, whatever the sender and contact", () => {
    for (const event of withoutLink) {
      for (const brandInSender of [false, true]) {
        for (const contact of CONTACTS) expect(render(event, { brandInSender, contact }).startsWith(BRAND_PREFIX), `${event} ${brandInSender} ${contact}`).toBe(true);
      }
    }
  });

  it("keep the brand for a generic sender, and trade it for the help contact only when the sender shows BeautyBOX", () => {
    for (const event of withLink) expect(render(event).startsWith(BRAND_PREFIX), event).toBe(true);
    // A generic sender: the brand stays and the help contact does not fit.
    const generic = render("ORDER_CONFIRMED");
    expect(generic.startsWith(BRAND_PREFIX)).toBe(true);
    expect(generic).not.toContain("Help:");
    // The sender shows BeautyBOX (and so does the link's address): the help contact fits instead.
    const branded = render("ORDER_CONFIRMED", { brandInSender: true });
    expect(branded).toBe(`Order BB-J2JS-KAWB is paid: RWF 1,250,000. Help: +250788123456. See your order: https://beautyboxmarket.com/o#${TOKEN}`);
    expect(smsLength(branded).parts).toBe(1);
    // Nothing to gain: the brand stays even with the BeautyBOX sender.
    expect(render("ORDER_CONFIRMED", { brandInSender: true, contact: null }).startsWith(BRAND_PREFIX)).toBe(true);
  });

  it("add the help contact or PIN warning only where it costs no extra part", () => {
    expect(render("REFUND_CONFIRMED")).toContain(" Help: +250788123456.");
    expect(render("ORDER_ON_HOLD")).toContain(" We never ask for your PIN.");
    expect(render("ACCESS_LINK")).not.toContain("Help:"); // 159 characters without it
    expect(render("ORDER_CONFIRMED", { contact: null })).not.toContain("Help");
  });

  it("ask the customer to get in touch, or say we will, for holds and delivery problems", () => {
    expect(render("ORDER_ON_HOLD")).toBe("BeautyBOX: We need to talk with you about order BB-J2JS-KAWB. Please contact us at +250788123456. We never ask for your PIN.");
    expect(render("DELIVERY_PROBLEM", { contact: null })).toBe("BeautyBOX: We need to talk with you about the delivery of order BB-J2JS-KAWB. We will contact you. We never ask for your PIN.");
  });

  it("clean a staff-typed support contact so it cannot switch the message to UCS-2", () => {
    const text = render("ORDER_ON_HOLD", { contact: "Aline’s desk – +250788123456" });
    expect(text).toContain("Please contact us at Aline's desk - +250788123456.");
    expect(smsLength(text)).toMatchObject({ encoding: "GSM-7", parts: 1 });
  });

  it("have no template for an unknown event", () => {
    expect(renderSms("SOMETHING_ELSE", { ...worst, link: null, contact: null, brandInSender: false })).toBeNull();
    expect(renderSms("toString", { ...worst, link: null, contact: null, brandInSender: false })).toBeNull();
  });
});

describe("delivery report labels for staff", () => {
  it("say in plain words what the network reported", () => {
    expect(smsDeliveryLabel("Success", null)).toBe("delivered to the phone");
    expect(smsDeliveryLabel("Failed", "UserDoesNotExist")).toBe("not delivered to the phone (user does not exist)");
    expect(smsDeliveryLabel("AbsentSubscriber", null)).toBe("phone unreachable (off or out of coverage)");
    expect(smsDeliveryLabel("Buffered", null)).toBe("queued by the network");
  });
});
