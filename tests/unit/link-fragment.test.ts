import { describe, expect, it } from "vitest";
import { tokenFromFragment } from "@/modules/orders/link-fragment";

// DR-049: the private-link page reads both link forms, and ignores punctuation a phone's
// linkifier may have glued onto the end of a link in an SMS.

const SHORT = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
const LONG = "A".repeat(40) + "b_-";

describe("tokenFromFragment", () => {
  it("reads the SMS form (#<token>) and the browser form (#token=<token>)", () => {
    expect(tokenFromFragment(`#${SHORT}`)).toBe(SHORT);
    expect(tokenFromFragment(`#token=${LONG}`)).toBe(LONG);
  });

  it("drops what a linkifier glued on after the token", () => {
    expect(tokenFromFragment(`#${SHORT}.`)).toBe(SHORT);
    expect(tokenFromFragment(`#${SHORT})`)).toBe(SHORT);
    expect(tokenFromFragment(`#${SHORT}%20Help`)).toBe(SHORT);
    expect(tokenFromFragment(`#token=${LONG}.`)).toBe(LONG);
  });

  it("finds nothing in an empty or unrelated fragment", () => {
    expect(tokenFromFragment("")).toBeNull();
    expect(tokenFromFragment("#")).toBeNull();
    expect(tokenFromFragment("#token=")).toBeNull();
    expect(tokenFromFragment("#.")).toBeNull();
  });
});
