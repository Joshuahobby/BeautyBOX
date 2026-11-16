import { describe, expect, it, vi } from "vitest";
import { checkGoogleDelivery } from "@/modules/delivery/google-check";

describe("bounded live-check runner with mocked public results", () => {
  it("stops on the first provider failure without retries or raw response text", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: "private-message" } }),
          { status: 403 },
        ),
      );
    const report = await checkGoogleDelivery({
      routesKey: "test",
      caseCount: 12,
      transport,
    });
    expect(report).toMatchObject({
      requests: 1,
      maximumRequests: 36,
      stoppedOnFailure: true,
      settingsChanged: false,
      outsideCityRejectedLocally: true,
    });
    expect(JSON.stringify(report)).not.toContain("private-message");
  });
  it("runs at most three requests per public case and reports only the fee", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith(":autocomplete"))
        return Response.json({
          suggestions: [
            {
              placePrediction: {
                placeId: "mock_place",
                text: { text: "Public landmark" },
              },
            },
          ],
        });
      if (String(url).includes("/places/"))
        return Response.json({
          id: "mock_place",
          displayName: { text: "Public landmark" },
          location: { latitude: -1.954442, longitude: 30.093295 },
        });
      return Response.json({ routes: [{ distanceMeters: 8000 }] });
    });
    const report = await checkGoogleDelivery({
      routesKey: "test",
      caseCount: 12,
      transport,
    });
    expect(report.requests).toBe(36);
    expect(report.cases).toHaveLength(12);
    expect(
      report.cases.every((c) => c.outcome === "ROUTED" && c.feeRwf === 2800),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/8000|-1\.954442|30\.093295/);
    expect(transport).toHaveBeenCalledTimes(36);
  });
  it("refuses unbounded counts before contacting a provider", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(
      checkGoogleDelivery({ routesKey: "test", caseCount: 13, transport }),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
