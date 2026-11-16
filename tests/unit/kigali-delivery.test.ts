import { describe, expect, it } from "vitest";
import {
  KIGALI_COVERAGE,
  KIGALI_TARIFF,
  SILVERBACK_MALL,
} from "@/config/delivery/kigali";
import boundary from "@/config/delivery/kigali-city.geojson.json";
import { isInsideCoverage } from "@/modules/delivery/coverage";
import { deliveryFeeRwf } from "@/modules/delivery/tariff";

describe("owner-selected Kigali delivery configuration", () => {
  it("preserves the complete unsimplified boundary with the correct coordinate order", () => {
    expect(KIGALI_COVERAGE.polygon).toHaveLength(1749);
    expect(boundary.properties.simplified).toBe(false);
    expect(isInsideCoverage(SILVERBACK_MALL, KIGALI_COVERAGE)).toBe(true);
    // Kigali's eastern/rural area was excluded by the old central rectangle.
    expect(isInsideCoverage({ lat: -1.93, lng: 30.23 }, KIGALI_COVERAGE)).toBe(
      true,
    );
    expect(
      isInsideCoverage({ lat: -1.499646, lng: 29.634962 }, KIGALI_COVERAGE),
    ).toBe(false);
    // A bounding rectangle is not a city boundary.
    expect(
      isInsideCoverage({ lat: -2.0798, lng: 29.9796 }, KIGALI_COVERAGE),
    ).toBe(false);
  });
  it("includes every vertex and a point on an actual boundary segment", () => {
    for (const [lat, lng] of KIGALI_COVERAGE.polygon)
      expect(isInsideCoverage({ lat, lng }, KIGALI_COVERAGE)).toBe(true);
    const [a, b] = KIGALI_COVERAGE.polygon;
    expect(
      isInsideCoverage(
        { lat: (a![0] + b![0]) / 2, lng: (a![1] + b![1]) / 2 },
        KIGALI_COVERAGE,
      ),
    ).toBe(true);
    expect(isInsideCoverage({ lat: NaN, lng: 30 }, KIGALI_COVERAGE)).toBe(
      false,
    );
  });
  it.each([
    [0, 1500],
    [3000, 1500],
    [3100, 1600],
    [5000, 2000],
    [8000, 2800],
    [10000, 3300],
    [20000, 5800],
    [32000, 8800],
  ])("prices %i road metres at RWF %i", (metres, fee) => {
    expect(deliveryFeeRwf(metres!, KIGALI_TARIFF)).toBe(fee);
  });
});
