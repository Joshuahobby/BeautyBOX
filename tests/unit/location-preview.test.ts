import { describe, expect, it } from "vitest";
import { manualPoint, mapEmbedUrl } from "@/lib/location-preview";

describe("manual delivery location and optional browser map", () => {
  it("keeps valid zero coordinates and rounds to the server's six decimal places", () => {
    expect(manualPoint("-1.9688464", "30.1025134")).toEqual({
      lat: -1.968846,
      lng: 30.102513,
    });
    expect(manualPoint("0", "0")).toEqual({ lat: 0, lng: 0 });
  });
  it.each([
    ["", "30"],
    ["-1", " "],
    ["not a latitude", "30"],
    ["91", "30"],
    ["-1", "181"],
    ["Infinity", "30"],
  ])("rejects invalid manual coordinates (%s, %s)", (lat, lng) => {
    expect(manualPoint(lat!, lng!)).toBeNull();
  });
  it("requires the explicit browser key and uses only the fixed Google Embed endpoint", () => {
    expect(mapEmbedUrl({ lat: -1.96, lng: 30.1 })).toBeNull();
    expect(mapEmbedUrl({ lat: NaN, lng: 30 }, "browser-test")).toBeNull();
    const url = new URL(
      mapEmbedUrl({ lat: -1.96, lng: 30.1 }, "browser-test")!,
    );
    expect(url.origin).toBe("https://www.google.com");
    expect(url.pathname).toBe("/maps/embed/v1/place");
    expect(url.searchParams.get("q")).toBe("-1.96,30.1");
    expect(url.searchParams.get("key")).toBe("browser-test");
  });
});
