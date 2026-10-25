import type { GeoPoint, PlacesAdapter, RouteResult, RoutingAdapter } from "./types";

// Deterministic FAKE routing for local development and tests only (I05). It is not a
// pricing method: production configuration rejects ROUTING_PROVIDER=fake. Distances
// are a fixed multiple of the great-circle distance so results are repeatable, and a
// few fixture destinations exercise exact tariff boundaries and failure states.

const ROAD_FACTOR = 1.35;

/** Fixture pins (rounded to 6 dp) with exact synthetic road distances or failures. */
export const FAKE_ROUTE_FIXTURES: { label: string; point: GeoPoint; result: RouteResult }[] = [
  { label: "Fixture: exactly 3.0 km", point: { lat: -1.95, lng: 30.07 }, result: ok(3000) },
  { label: "Fixture: 3.1 km", point: { lat: -1.951, lng: 30.071 }, result: ok(3100) },
  { label: "Fixture: 5.0 km", point: { lat: -1.952, lng: 30.072 }, result: ok(5000) },
  { label: "Fixture: route service unavailable", point: { lat: -1.953, lng: 30.073 }, result: { kind: "UNAVAILABLE", reason: "simulated outage" } },
  { label: "Fixture: no motorcycle route", point: { lat: -1.954, lng: 30.074 }, result: { kind: "NO_ROUTE" } },
];

function ok(distanceMetres: number): RouteResult {
  return { kind: "OK", distanceMetres, durationSeconds: Math.round(distanceMetres / 6), attribution: null, evidenceRef: null };
}

const samePoint = (a: GeoPoint, b: GeoPoint) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;

export function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class FakeRoutingAdapter implements RoutingAdapter {
  readonly provider = "FAKE" as const;

  async route(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult> {
    const fixture = FAKE_ROUTE_FIXTURES.find((f) => samePoint(f.point, destination));
    if (fixture) return fixture.result;
    return ok(Math.max(1, Math.round(haversineMetres(origin, destination) * ROAD_FACTOR)));
  }
}

/** Synthetic place list (approximate public landmarks in Kigali) for the demo search box. */
const FAKE_PLACES: { placeId: string; label: string; secondary: string; point: GeoPoint }[] = [
  { placeId: "demo-kcc", label: "Kigali Convention Centre", secondary: "Kimihurura, Gasabo (demo place)", point: { lat: -1.954442, lng: 30.093295 } },
  { placeId: "demo-kimironko", label: "Kimironko Market", secondary: "Kimironko, Gasabo (demo place)", point: { lat: -1.949318, lng: 30.126091 } },
  { placeId: "demo-nyabugogo", label: "Nyabugogo Bus Park", secondary: "Nyarugenge (demo place)", point: { lat: -1.939381, lng: 30.044548 } },
  { placeId: "demo-remera", label: "Amahoro Stadium", secondary: "Remera, Gasabo (demo place)", point: { lat: -1.955653, lng: 30.118206 } },
  { placeId: "demo-kicukiro", label: "Kicukiro Centre", secondary: "Kicukiro (demo place)", point: { lat: -1.973512, lng: 30.102581 } },
  { placeId: "demo-nyamirambo", label: "Nyamirambo", secondary: "Nyarugenge (demo place)", point: { lat: -1.978702, lng: 30.043812 } },
  { placeId: "demo-airport", label: "Kigali International Airport", secondary: "Kanombe (demo place)", point: { lat: -1.963041, lng: 30.135011 } },
  { placeId: "demo-musanze", label: "Musanze town", secondary: "Northern Province, outside demo coverage", point: { lat: -1.499646, lng: 29.634962 } },
  ...FAKE_ROUTE_FIXTURES.map((f, i) => ({ placeId: `fixture-${i}`, label: f.label, secondary: "Test fixture", point: f.point })),
];

export class FakePlacesAdapter implements PlacesAdapter {
  readonly provider = "FAKE" as const;

  async search(query: string) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return FAKE_PLACES.filter((p) => `${p.label} ${p.secondary}`.toLowerCase().includes(q))
      .slice(0, 8)
      .map(({ placeId, label, secondary }) => ({ placeId, label, secondary }));
  }

  async resolve(placeId: string) {
    const place = FAKE_PLACES.find((p) => p.placeId === placeId);
    return place ? { label: place.label, point: place.point } : null;
  }
}
