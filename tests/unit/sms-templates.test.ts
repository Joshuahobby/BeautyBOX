import { describe, expect, it } from "vitest";
import { nonGsm7Characters, smsLength } from "@/adapters/sms/gsm7";
import { renderSms, SMS_TEMPLATES } from "@/modules/notifications/templates";
import { smsDeliveryLabel } from "@/components/staff/labels";

// DR-048: every template is plain GSM-7 as written (no curly quotes, dashes or ellipses), and
// its length in parts is recorded here, so a wording change that adds a part is noticed.
// `npm run sms:lengths` prints the full table.

const LINK = `https://beautyboxmarket.com/order-access#token=${"A".repeat(43)}`;
const base = { reference: "BB-J2JS-KAWB", amount: "RWF 129,100", link: LINK };

describe("SMS templates", () => {
  it("are written in GSM-7 only, with and without the optional parts", () => {
    for (const [event, template] of Object.entries(SMS_TEMPLATES)) {
      for (const contact of [null, "+250788123456", "help@beautyboxmarket.com"]) {
        const raw = template.text({ ...base, link: template.needsLink ? LINK : null, contact, help: contact ? ` Help: ${contact}.` : "" });
        expect(nonGsm7Characters(raw), `${event} with contact ${contact ?? "none"}`).toEqual([]);
      }
    }
  });

  it("record their length in parts on the production address (today's link)", () => {
    const parts = (event: string, contact: string | null) => smsLength(renderSms(event, { ...base, contact })!).parts;
    const table = Object.fromEntries(Object.keys(SMS_TEMPLATES).map((e) => [e, [parts(e, null), parts(e, "+250788123456")]]));
    // [without help contact, with the support phone]
    expect(table).toEqual({
      ORDER_CONFIRMED: [2, 2],
      ORDER_DISPATCHED: [2, 2],
      ORDER_ON_HOLD: [1, 1],
      DELIVERY_PROBLEM: [1, 1],
      REFUND_CONFIRMED: [1, 1],
      ACCESS_LINK: [2, 2],
    });
  });

  it("clean a staff-typed support contact so it cannot switch the message to UCS-2", () => {
    const text = renderSms("ORDER_ON_HOLD", { ...base, link: null, contact: "Aline’s desk – +250788123456" })!;
    expect(text).toBe("BeautyBOX: We need to contact you about order BB-J2JS-KAWB. Please contact Aline's desk - +250788123456.");
    expect(smsLength(text)).toMatchObject({ encoding: "GSM-7", parts: 1 });
  });

  it("have no template for an unknown event", () => {
    expect(renderSms("SOMETHING_ELSE", { ...base, contact: null })).toBeNull();
    expect(renderSms("toString", { ...base, contact: null })).toBeNull();
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
