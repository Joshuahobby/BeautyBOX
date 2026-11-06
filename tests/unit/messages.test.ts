import { describe, expect, it } from "vitest";
import { currentKigaliYear } from "@/messages";

// Dates shown to visitors follow Africa/Kigali (UTC+2, no daylight saving), not the server's clock.

describe("currentKigaliYear", () => {
  it("turns over at midnight in Kigali, two hours before UTC does", () => {
    expect(currentKigaliYear(new Date("2026-12-31T21:59:59Z"))).toBe("2026");
    expect(currentKigaliYear(new Date("2026-12-31T22:00:00Z"))).toBe("2027");
  });
});
