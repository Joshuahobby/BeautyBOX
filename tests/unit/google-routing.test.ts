import { describe, it, expect, vi } from "vitest";
import {
  GooglePlacesAdapter,
  GoogleRoutingAdapter,
} from "@/adapters/routing/google";
import { googleJson } from "@/adapters/routing/google-http";
import { SILVERBACK_MALL } from "@/config/delivery/kigali";

const destination = { lat: -1.954442, lng: 30.093295 };
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const transport = (value: unknown, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(reply(value, status));

describe("bounded server-only Google routing", () => {
  it("requests exactly motorcycle road distance without an alternate mode or retry", async () => {
    const http = transport({
      routes: [{ distanceMeters: 3100, duration: "400.5s" }],
    });
    const adapter = new GoogleRoutingAdapter("unit-test-key", true, http);
    expect(await adapter.route(SILVERBACK_MALL, destination)).toMatchObject({
      kind: "OK",
      distanceMetres: 3100,
      durationSeconds: 401,
      evidenceRef: null,
    });
    expect(http).toHaveBeenCalledTimes(1);
    const [url, options] = http.mock.calls[0]!;
    expect(url).toBe(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
    );
    expect(options).toMatchObject({
      redirect: "error",
      cache: "no-store",
      headers: {
        "X-Goog-Api-Key": "unit-test-key",
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
    });
    expect(JSON.parse(options!.body as string)).toMatchObject({
      travelMode: "TWO_WHEELER",
      routingPreference: "TRAFFIC_UNAWARE",
      computeAlternativeRoutes: false,
      units: "METRIC",
    });
  });
  it("does not call Google before coverage evidence is approved or for invalid points", async () => {
    const http = transport({});
    expect(
      (
        await new GoogleRoutingAdapter("test", false, http).route(
          SILVERBACK_MALL,
          destination,
        )
      ).kind,
    ).toBe("UNAVAILABLE");
    expect(
      (
        await new GoogleRoutingAdapter("test", true, http).route(
          SILVERBACK_MALL,
          { lat: NaN, lng: 30 },
        )
      ).kind,
    ).toBe("UNAVAILABLE");
    expect(http).not.toHaveBeenCalled();
  });
  it.each([{}, { routes: [] }])(
    "distinguishes an empty motorcycle route from an outage (%j)",
    async (payload) => {
      const http = transport(payload);
      expect(
        await new GoogleRoutingAdapter("test", true, http).route(
          SILVERBACK_MALL,
          destination,
        ),
      ).toEqual({ kind: "NO_ROUTE" });
    },
  );
  it.each([403, 429, 500, 503])(
    "fails closed on HTTP %i without provider text or retry",
    async (status) => {
      const http = transport(
        { error: { message: "PRIVATE PROVIDER MESSAGE" } },
        status,
      );
      const result = await new GoogleRoutingAdapter(
        "private-test-value",
        true,
        http,
      ).route(SILVERBACK_MALL, destination);
      expect(result.kind).toBe("UNAVAILABLE");
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE|private-test-value/);
      expect(http).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { routes: [{ distanceMeters: -1 }] },
    { routes: [{ distanceMeters: 1.5 }] },
    { routes: [{ distanceMeters: "5000" }] },
    { routes: [{ duration: "100s" }] },
    { routes: [{ distanceMeters: 5000, duration: "-1s" }] },
  ])("rejects malformed distances/durations (%j)", async (payload) => {
    expect(
      (
        await new GoogleRoutingAdapter("test", true, transport(payload)).route(
          SILVERBACK_MALL,
          destination,
        )
      ).kind,
    ).toBe("UNAVAILABLE");
  });
  it("bounds response bytes, timeout and network/JSON failures", async () => {
    const tooBig = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("x".repeat(256 * 1024 + 1)));
    expect(
      await googleJson("https://routes.googleapis.com", "test", {}, tooBig),
    ).toEqual({ ok: false });
    const invalid = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not json"));
    expect(
      await googleJson("https://routes.googleapis.com", "test", {}, invalid),
    ).toEqual({ ok: false });
    const broken = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network secret"));
    expect(
      await googleJson("https://routes.googleapis.com", "test", {}, broken),
    ).toEqual({ ok: false });
    expect(broken).toHaveBeenCalledTimes(1);
    expect(broken.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("Google Places API (New)", () => {
  it("limits suggestions to Rwanda with a bias around the dispatch point", async () => {
    const http = transport({
      suggestions: [
        {
          placePrediction: {
            placeId: "place_1",
            text: { text: "KCC, Kigali" },
            structuredFormat: {
              mainText: { text: "KCC" },
              secondaryText: { text: "Kigali" },
            },
          },
        },
      ],
    });
    const places = new GooglePlacesAdapter("places-unit", http);
    expect(await places.search(" KCC ")).toEqual([
      { placeId: "place_1", label: "KCC", secondary: "Kigali" },
    ]);
    expect(JSON.parse(http.mock.calls[0]![1]!.body as string)).toMatchObject({
      input: "KCC",
      includedRegionCodes: ["rw"],
      includeQueryPredictions: false,
      locationBias: { circle: { radius: 30000 } },
    });
    expect(http.mock.calls[0]![0]).not.toContain("places-unit");
    expect(await places.search("x")).toEqual([]);
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("resolves only matching valid place identifiers and finite coordinates", async () => {
    const http = transport({
      id: "place_1",
      displayName: { text: "KCC" },
      location: { latitude: destination.lat, longitude: destination.lng },
    });
    expect(
      await new GooglePlacesAdapter("test", http).resolve("place_1"),
    ).toEqual({ label: "KCC", point: destination });
    expect(
      await new GooglePlacesAdapter("test", http).resolve("../bad"),
    ).toBeNull();
    expect(http).toHaveBeenCalledTimes(1);
    expect(
      await new GooglePlacesAdapter(
        "test",
        transport({
          id: "other",
          location: { latitude: -1.9, longitude: 30.1 },
        }),
      ).resolve("place_1"),
    ).toBeNull();
  });
  it("returns a controlled unavailable result for denied/malformed suggestions", async () => {
    expect(
      await new GooglePlacesAdapter("test", transport({}, 403)).search(
        "Kigali",
      ),
    ).toBeNull();
    expect(
      await new GooglePlacesAdapter(
        "test",
        transport({ suggestions: "bad" }),
      ).search("Kigali"),
    ).toBeNull();
    expect(
      await new GooglePlacesAdapter("test", transport({})).search("Kigali"),
    ).toEqual([]);
  });
});
