import { describe, expect, it } from "vitest";
import {
  EMAIL_TEMPLATES,
  renderEmail,
} from "@/modules/notifications/email-templates";

const base = {
  recipientName: "Aline",
  reference: "BB-TEST-0001",
  amount: "RWF 12,500",
  link: "https://shop.example/order-access#token=abc",
  supportPhone: "+250 788 641 811",
  supportEmail: "care@beautyboxmarket.com",
  supportHours: "24 hours a day, 7 days a week",
};

describe("order e-mail wording (DR-059)", () => {
  it("has a message for every notification event", () => {
    expect(Object.keys(EMAIL_TEMPLATES).sort()).toEqual(
      [
        "ACCESS_LINK",
        "DELIVERY_PROBLEM",
        "ORDER_CONFIRMED",
        "ORDER_DISPATCHED",
        "ORDER_ON_HOLD",
        "REFUND_CONFIRMED",
      ].sort(),
    );
  });

  it("carries the private link, support contact and PIN warning", () => {
    const m = renderEmail("ORDER_CONFIRMED", base)!;
    expect(m.subject).toContain("BB-TEST-0001");
    expect(m.text).toContain(base.link);
    expect(m.text).toContain("+250 788 641 811");
    expect(m.text).toContain("never asks for your mobile-money PIN");
    expect(m.html).toContain(`href="${base.link}"`);
  });

  it("refuses to render a link message without a link, and leaves links out of others", () => {
    expect(renderEmail("ORDER_CONFIRMED", { ...base, link: null })).toBeNull();
    const refund = renderEmail("REFUND_CONFIRMED", { ...base, link: null })!;
    expect(refund.text).not.toContain("order-access");
    expect(renderEmail("NOT_AN_EVENT", base)).toBeNull();
  });

  it("escapes customer-entered text in the HTML version", () => {
    const m = renderEmail("ORDER_CONFIRMED", {
      ...base,
      recipientName: '<img src=x onerror="alert(1)">',
    })!;
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;img");
  });

  it("omits the help block when no contact is configured", () => {
    const m = renderEmail("ORDER_ON_HOLD", {
      ...base,
      supportPhone: null,
      supportEmail: null,
    })!;
    expect(m.text).not.toContain("Need help?");
  });
});
