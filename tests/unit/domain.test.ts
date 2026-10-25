import { describe, expect, it } from "vitest";
import { deliveryFeeRwf } from "@/modules/delivery/tariff";
import { formatRwf, multiplyRwf, sumRwf, toRwf } from "@/modules/shared/money";
import { maskPhone, normalizeRwandaMobile, toMsisdn } from "@/modules/shared/phone";
import { isInsideCoverage, parseCoverage } from "@/modules/delivery/coverage";
import { basketFingerprint } from "@/modules/cart/basket";
import { format } from "@/messages";
import { newOrderReference } from "@/modules/orders/reference";

const TARIFF = { baseRwf: 1500, includedMetres: 3000, extraRwfPerKm: 300, roundingRwf: 100 };

describe("delivery tariff (FSD DEL-03, handoff validation fixtures)", () => {
  it.each([
    [1000, 1500],
    [3000, 1500],
    [3100, 1600],
    [5000, 2100],
    [8000, 3000],
    [10000, 3600],
    [15000, 5100],
    [3001, 1600], // fractional kilometre enters before rounding up
    [0, 1500],
  ])("%i m -> RWF %i", (metres, fee) => {
    expect(deliveryFeeRwf(metres, TARIFF)).toBe(fee);
  });

  it("rejects invalid inputs instead of guessing", () => {
    expect(() => deliveryFeeRwf(-1, TARIFF)).toThrow();
    expect(() => deliveryFeeRwf(1.5, TARIFF)).toThrow();
    expect(() => deliveryFeeRwf(1000, { ...TARIFF, roundingRwf: 0 })).toThrow();
  });
});

describe("money", () => {
  it("formats whole RWF with grouping and no decimals", () => {
    expect(formatRwf(29100)).toBe("RWF 29,100");
    expect(formatRwf(0)).toBe("RWF 0");
    expect(sumRwf([27000, 2100])).toBe(29100);
    expect(multiplyRwf(15000, 2)).toBe(30000);
  });

  it("refuses non-integer and unsafe amounts", () => {
    expect(() => toRwf(1.5)).toThrow();
    expect(() => toRwf(-1)).toThrow();
    expect(() => toRwf(2n ** 60n)).toThrow();
    expect(() => formatRwf(Number.NaN)).toThrow();
  });
});

describe("Rwanda phone numbers", () => {
  it("normalizes valid mobile numbers to E.164", () => {
    expect(normalizeRwandaMobile("0788 123 456")).toEqual({ ok: true, e164: "+250788123456" });
    expect(normalizeRwandaMobile("+250 73 123 4567")).toEqual({ ok: true, e164: "+250731234567" });
    expect(normalizeRwandaMobile("250788123456")).toEqual({ ok: true, e164: "+250788123456" });
  });

  it("rejects invalid, foreign and non-mobile numbers", () => {
    for (const bad of ["", "12345", "+254712345678", "+250252123456", "+25078812345", "0788-ABC-456"]) {
      expect(normalizeRwandaMobile(bad).ok).toBe(false);
    }
  });

  it("masks and converts for provider use", () => {
    expect(maskPhone("+250788123456")).toBe("+250 7•• ••• 456");
    expect(toMsisdn("+250788123456")).toBe("250788123456");
  });
});

describe("coverage polygon", () => {
  const rules = parseCoverage({ type: "polygon", label: "test", polygon: [[-1.86, 29.98], [-1.86, 30.2], [-2.06, 30.2], [-2.06, 29.98]] });
  it("accepts points inside and rejects points outside", () => {
    expect(isInsideCoverage({ lat: -1.95, lng: 30.07 }, rules)).toBe(true);
    expect(isInsideCoverage({ lat: -1.5, lng: 29.63 }, rules)).toBe(false);
  });
  it("rejects malformed rules", () => {
    expect(() => parseCoverage({ type: "polygon", label: "x", polygon: [[0, 0]] })).toThrow();
  });
});

describe("quote binding", () => {
  it("fingerprints the priced basket independent of line order", () => {
    const a = { variantId: "a", quantity: 1, unitPriceRwf: 100, priceVersion: 1, parcelClass: "STANDARD" as const };
    const b = { variantId: "b", quantity: 2, unitPriceRwf: 200, priceVersion: 1, parcelClass: "STANDARD" as const };
    expect(basketFingerprint([a, b])).toBe(basketFingerprint([b, a]));
    expect(basketFingerprint([a, b])).not.toBe(basketFingerprint([a, { ...b, quantity: 3 }]));
    expect(basketFingerprint([a, b])).not.toBe(basketFingerprint([a, { ...b, priceVersion: 2 }]));
  });
});

describe("copy and references", () => {
  it("fills only known placeholders", () => {
    expect(format("Pay {amount}", { amount: "RWF 29,100" })).toBe("Pay RWF 29,100");
    expect(format("Hi {missing}", {})).toBe("Hi {missing}");
  });
  it("creates non-sequential, unambiguous order references", () => {
    const refs = new Set(Array.from({ length: 200 }, () => newOrderReference()));
    expect(refs.size).toBe(200);
    for (const r of refs) expect(r).toMatch(/^BB-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/);
  });
});
