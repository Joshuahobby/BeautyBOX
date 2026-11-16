import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { setAdaptersForTests } from "@/adapters/registry";
import {
  GooglePlacesAdapter,
  GoogleRoutingAdapter,
} from "@/adapters/routing/google";
import { configureKigali } from "@/modules/delivery/configure-kigali";
import { KIGALI_COVERAGE, SILVERBACK_MALL } from "@/config/delivery/kigali";
import boundary from "@/config/delivery/kigali-city.geojson.json";
import { operatingContext } from "@/modules/settings/settings";
import { getCheckoutView, updateCheckout } from "@/modules/checkout/checkout";
import { requestQuote } from "@/modules/delivery/quote";
import { GUEST_COOKIE } from "@/modules/session/guest-session";
import * as settingsRoute from "@/app/api/v1/staff/settings/route";
import { GET as searchPlaces } from "@/app/api/v1/places/route";
import { GET as resolvePlace } from "@/app/api/v1/places/[placeId]/route";
import {
  addToCart,
  newCustomer,
  readyCheckout,
  resetDatabase,
  seedShop,
  startFreshRateLimitWindow,
  key,
  pay,
  expectDomainError,
  ownerQuery,
  drainJobs,
  settleAndDrain,
  type Shop,
} from "./harness";

let shop: Shop;
const landmark = { lat: -1.954442, lng: 30.093295 };
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
beforeEach(async () => {
  await resetDatabase();
  shop = await seedShop();
});
async function apply() {
  return configureKigali({
    apply: true,
    expectedVersion: (await operatingContext()).settings.version,
  });
}
async function basket() {
  const customer = await newCustomer();
  await addToCart(customer, shop.cleanser.id, 1);
  return customer;
}

describe("versioned local Kigali configuration", () => {
  it("previews without writes; applies once while preserving the inventory location and release switches", async () => {
    expect(await configureKigali({ apply: false })).toMatchObject({
      applied: false,
      version: 1,
      originChanged: true,
      tariffChanged: true,
      vertices: 1749,
    });
    expect(await db().settingsVersion.count()).toBe(1);
    await apply();
    const ctx = await operatingContext();
    expect(ctx.location).toMatchObject({
      id: shop.location.id,
      version: 2,
      label: SILVERBACK_MALL.label,
      approvalState: "PROPOSED",
    });
    expect(ctx.tariff).toMatchObject({
      version: 2,
      extraRwfPerKm: 250n,
      maxDistanceMetres: 100000,
      approvalState: "PROPOSED",
    });
    expect(ctx.settings).toMatchObject({
      version: 2,
      checkoutEnabled: shop.settings.checkoutEnabled,
      livePaymentsEnabled: false,
      policiesApproved: false,
      notificationsEnabled: shop.settings.notificationsEnabled,
    });
    expect(
      await db().inventoryLot.count({
        where: { locationId: shop.location.id },
      }),
    ).toBeGreaterThan(0);
    // JSONB returns keys in a different order; a second application must still be a no-op.
    expect(await apply()).toMatchObject({
      applied: false,
      version: 2,
      originChanged: false,
      tariffChanged: false,
    });
    expect(await db().tariff.count()).toBe(2);
    await expectDomainError(
      configureKigali({ apply: true, expectedVersion: 1 }),
      "VERSION_CONFLICT",
    );
    expect(
      await db().auditEvent.count({
        where: { action: "KIGALI_DELIVERY_CONFIGURED" },
      }),
    ).toBe(1);
  });
  it("rejects shared/production database profiles and serializes competing changes", async () => {
    await ownerQuery(
      "UPDATE commerce.deployment_profile SET environment = 'STAGING'",
    );
    await expect(apply()).rejects.toThrow(
      "Local/test database profile required",
    );
    await ownerQuery(
      "UPDATE commerce.deployment_profile SET environment = 'TEST'",
    );
    const results = await Promise.allSettled([
      configureKigali({ apply: true, expectedVersion: 1 }),
      configureKigali({ apply: true, expectedVersion: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db().settingsVersion.count()).toBe(2);
  });
  it("invalidates an earlier quote while preserving a placed order's snapshot", async () => {
    const priorBuyer = await basket();
    const prior = await readyCheckout(priorBuyer);
    const payment = await pay(priorBuyer, prior);
    await drainJobs();
    await settleAndDrain(6);
    const attempt = await db().paymentAttempt.findUniqueOrThrow({
      where: { id: payment.attemptId },
    });
    const order = await db().order.findUniqueOrThrow({
      where: { id: attempt.orderId! },
    });
    const customer = await basket();
    const old = await readyCheckout(customer);
    expect(old.quote.amountRwf).toBe(2100);
    await apply();
    await expectDomainError(pay(customer, old), "QUOTE_INVALID");
    expect((await readyCheckout(customer)).quote.amountRwf).toBe(2000);
    expect(
      (await db().order.findUniqueOrThrow({ where: { id: order.id } }))
        .deliveryRwf,
    ).toBe(2100n);
  });
  it("accepts the full boundary only at the authenticated admin settings body limit", async () => {
    const auth = randomUUID();
    await db().staffMember.create({
      data: {
        authUserId: auth,
        displayName: "Test admin",
        email: "admin@example.test",
        role: "ADMIN",
      },
    });
    const headers = {
      origin: process.env.APP_ORIGIN!,
      "x-test-staff": `${auth}:aal2`,
      "content-type": "application/json",
      "idempotency-key": key(),
    };
    const path = process.env.APP_ORIGIN! + "/api/v1/staff/settings";
    const context = { params: Promise.resolve({}) };
    const before = await settingsRoute.GET(
      new NextRequest(path, { headers }),
      context,
    );
    const {
      version,
      publicationBlocks: _blocks,
      ...view
    } = await before.json();
    const body = JSON.stringify({
      expectedVersion: version,
      settings: { ...view, coverageGeoJson: boundary.geometry },
      reason: "Full Kigali boundary rehearsal",
    });
    expect(Buffer.byteLength(body)).toBeGreaterThan(16 * 1024);
    const updated = await settingsRoute.PUT(
      new NextRequest(path, { method: "PUT", headers, body }),
      context,
    );
    expect(updated.status).toBe(200);
    expect(
      ((await updated.json()).coverageGeoJson.coordinates[0] as unknown[])
        .length,
    ).toBe(KIGALI_COVERAGE.polygon.length + 1);
    const unauthenticated = await settingsRoute.PUT(
      new NextRequest(path, {
        method: "PUT",
        headers: {
          origin: process.env.APP_ORIGIN!,
          "content-type": "application/json",
        },
        body,
      }),
      context,
    );
    expect(unauthenticated.status).toBe(401);
  });
});

describe("Google motorcycle quote integration (mock HTTP; no billable calls)", () => {
  beforeEach(apply);
  it.each([
    [3000, 1500],
    [3100, 1600],
    [5000, 2000],
    [8000, 2800],
    [10000, 3300],
    [32000, 8800],
  ])("quotes %i actual provider metres at RWF %i", async (metres, fee) => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        reply({ routes: [{ distanceMeters: metres, duration: "300s" }] }),
      );
    setAdaptersForTests({
      routing: new GoogleRoutingAdapter("integration-test", true, http),
    });
    const customer = await basket();
    const ready = await readyCheckout(customer, landmark);
    expect(ready.quote.amountRwf).toBe(fee);
    const stored = await db().deliveryQuote.findUniqueOrThrow({
      where: { id: ready.quote.id },
    });
    expect(stored).toMatchObject({
      routeProvider: "GOOGLE",
      distanceMetres: null,
      providerEvidenceRef: null,
      originVersion: 2,
    });
    const request = JSON.parse(http.mock.calls[0]![1]!.body as string);
    expect(request).toMatchObject({
      travelMode: "TWO_WHEELER",
      origin: {
        location: {
          latLng: {
            latitude: SILVERBACK_MALL.lat,
            longitude: SILVERBACK_MALL.lng,
          },
        },
      },
    });
  });
  it("supersedes the quote when the customer changes location", async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ routes: [{ distanceMeters: 5000 }] }))
      .mockResolvedValueOnce(reply({ routes: [{ distanceMeters: 10000 }] }));
    setAdaptersForTests({
      routing: new GoogleRoutingAdapter("test", true, http),
    });
    const customer = await basket();
    const first = await readyCheckout(customer, landmark);
    const checkout = await getCheckoutView(customer, first.checkout.id);
    const changed = await updateCheckout(
      customer,
      checkout.id,
      {
        expectedRevision: checkout.revision,
        recipient: {
          name: "Test Recipient",
          phone: "+250788555111",
          landmark: "Blue gate",
        },
        destination: { lat: -1.93, lng: 30.23 },
        destinationConfirmed: "CUSTOMER_CONFIRMED",
      },
      key(),
    );
    const next = await requestQuote(
      customer,
      checkout.id,
      { expectedRevision: changed.revision },
      key(),
    );
    expect(next.amountRwf).toBe(3300);
    expect(
      (
        await db().deliveryQuote.findUniqueOrThrow({
          where: { id: first.quote.id },
        })
      ).state,
    ).toBe("SUPERSEDED");
    await expectDomainError(pay(customer, first), "VERSION_CONFLICT");
    await expectDomainError(
      pay(customer, {
        ...first,
        checkout: { ...first.checkout, revision: changed.revision },
      }),
      "QUOTE_INVALID",
    );
    expect(await db().paymentAttempt.count()).toBe(0);
  });
  it.each([
    [{}, 200, "OUTSIDE_COVERAGE"],
    [{ routes: [] }, 200, "OUTSIDE_COVERAGE"],
    [{}, 403, "PROVIDER_UNAVAILABLE"],
    [{}, 503, "PROVIDER_UNAVAILABLE"],
    [{ routes: [{ distanceMeters: 100001 }] }, 200, "OUTSIDE_COVERAGE"],
  ])(
    "does not quote an absent, denied or anomalous route (%j)",
    async (payload, status, code) => {
      const http = vi
        .fn<typeof fetch>()
        .mockResolvedValue(reply(payload, status as number));
      setAdaptersForTests({
        routing: new GoogleRoutingAdapter("test", true, http),
      });
      await expectDomainError(
        readyCheckout(await basket(), landmark),
        code as string,
      );
      expect(await db().deliveryQuote.count()).toBe(0);
      expect(http).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects outside-city destinations before contacting Google", async () => {
    const http = vi.fn<typeof fetch>();
    setAdaptersForTests({
      routing: new GoogleRoutingAdapter("test", true, http),
    });
    await expectDomainError(
      readyCheckout(await basket(), { lat: -1.499646, lng: 29.634962 }),
      "OUTSIDE_COVERAGE",
    );
    expect(http).not.toHaveBeenCalled();
  });
  it("wires authenticated place suggestions and resolution through the existing API", async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        reply({
          suggestions: [
            {
              placePrediction: { placeId: "mock_place", text: { text: "KCC" } },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        reply({
          id: "mock_place",
          displayName: { text: "KCC" },
          location: { latitude: landmark.lat, longitude: landmark.lng },
        }),
      );
    setAdaptersForTests({ places: new GooglePlacesAdapter("test", http) });
    const customer = await newCustomer();
    const headers = { cookie: `${GUEST_COOKIE}=${customer.token}` };
    const res = await searchPlaces(
      new NextRequest(process.env.APP_ORIGIN! + "/api/v1/places?q=KCC", {
        headers,
      }),
      { params: Promise.resolve({}) },
    );
    expect(await res.json()).toEqual({
      items: [{ placeId: "mock_place", label: "KCC", secondary: null }],
    });
    const resolved = await resolvePlace(
      new NextRequest(process.env.APP_ORIGIN! + "/api/v1/places/mock_place", {
        headers,
      }),
      { params: Promise.resolve({ placeId: "mock_place" }) },
    );
    expect(await resolved.json()).toEqual({ label: "KCC", point: landmark });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("limits billable place resolution with the same guest budget as autocomplete", async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        reply({
          id: "mock_place",
          displayName: { text: "KCC" },
          location: { latitude: landmark.lat, longitude: landmark.lng },
        }),
      );
    setAdaptersForTests({ places: new GooglePlacesAdapter("test", http) });
    const customer = await newCustomer();
    const headers = { cookie: `${GUEST_COOKIE}=${customer.token}` };
    startFreshRateLimitWindow();
    let response: Response | undefined;
    for (let i = 0; i < 31; i++)
      response = await resolvePlace(
        new NextRequest(process.env.APP_ORIGIN! + "/api/v1/places/mock_place", {
          headers,
        }),
        { params: Promise.resolve({ placeId: "mock_place" }) },
      );
    expect(response!.status).toBe(429);
    expect(http).toHaveBeenCalledTimes(30);
  });
});
