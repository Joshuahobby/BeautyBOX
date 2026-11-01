import { describe, expect, it } from "vitest";
import { isGsm7, nonGsm7Characters, smsLength, toGsm7 } from "@/adapters/sms/gsm7";

// DR-048: SMS text is counted the way the network counts it, and stray characters that would
// switch a message to UCS-2 (and more than double its cost) are replaced before sending.

describe("GSM-7 length and parts", () => {
  it("fits 160 plain characters in one part and splits at 153 after that", () => {
    expect(smsLength("a".repeat(160))).toEqual({ encoding: "GSM-7", units: 160, parts: 1 });
    expect(smsLength("a".repeat(161))).toEqual({ encoding: "GSM-7", units: 161, parts: 2 });
    expect(smsLength("a".repeat(306))).toEqual({ encoding: "GSM-7", units: 306, parts: 2 });
    expect(smsLength("a".repeat(307))).toEqual({ encoding: "GSM-7", units: 307, parts: 3 });
  });

  it("counts extension characters twice and never splits one between parts", () => {
    expect(smsLength("€".repeat(80))).toEqual({ encoding: "GSM-7", units: 160, parts: 1 });
    expect(smsLength(`${"a".repeat(159)}€`)).toEqual({ encoding: "GSM-7", units: 161, parts: 2 });
    // 152 septets, then a two-septet character that cannot start in the last free septet.
    expect(smsLength(`${"a".repeat(152)}{${"a".repeat(152)}`).parts).toBe(3);
  });

  it("switches to UCS-2 for one character outside the set: 70 in one part, 67 after that", () => {
    expect(smsLength(`${"a".repeat(69)}’`)).toEqual({ encoding: "UCS-2", units: 70, parts: 1 });
    expect(smsLength(`${"a".repeat(70)}’`)).toEqual({ encoding: "UCS-2", units: 71, parts: 2 });
    expect(smsLength("a".repeat(134) + "’")).toEqual({ encoding: "UCS-2", units: 135, parts: 3 });
  });

  it("knows the GSM-7 letters, including the accented ones in the set", () => {
    expect(isGsm7("BeautyBOX: RWF 29,100. Help: +250788123456 / help@example.rw #_-")).toBe(true);
    expect(isGsm7("é è ù ì ò Ç Ø ø Å å Ä Ö Ñ Ü ä ö ñ ü à ß É Æ æ")).toBe(true);
    expect(nonGsm7Characters("It’s “ready” – now…")).toEqual(["’", "“", "”", "–", "…"]);
  });
});

describe("toGsm7", () => {
  it("replaces look-alike punctuation and spaces with plain forms", () => {
    expect(toGsm7("It’s “ready” – now… a b c​d")).toBe(`It's "ready" - now... a b cd`);
  });

  it("drops accents the set does not have, keeps the ones it has, and marks anything else", () => {
    expect(toGsm7("Café Kigali, Muhanga: ê á í ç é")).toBe("Café Kigali, Muhanga: e a i c é");
    expect(toGsm7("Order ✓ 😀")).toBe("Order ? ?");
  });

  it("reads a decomposed accent (letter + combining mark) like the composed letter", () => {
    expect(toGsm7("Café Angèle, Mûso")).toBe("Café Angèle, Muso");
    expect(toGsm7("́x")).toBe("x");
  });

  it("leaves GSM-7 text exactly as it is", () => {
    const text = "BeautyBOX: Payment received for order BB-J2JS-KAWB, RWF 29,100. {Help}: €5";
    expect(toGsm7(text)).toBe(text);
  });
});
