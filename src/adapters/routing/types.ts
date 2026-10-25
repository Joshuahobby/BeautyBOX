// Routing and place-search adapter contract (handoff technical/Integrations.md).
// Only the server quote service turns a route into a fee. There is never a
// straight-line or alternate-mode fallback when the motorcycle route fails.

export type GeoPoint = { lat: number; lng: number };

export type RouteResult =
  | {
      kind: "OK";
      distanceMetres: number;
      durationSeconds: number | null;
      /** Attribution text the UI must display for this provider, if any. */
      attribution: string | null;
      /** Reference to retained evidence, only where provider terms permit retention. */
      evidenceRef: string | null;
    }
  | { kind: "NO_ROUTE" }
  | { kind: "UNAVAILABLE"; reason: string };

export interface RoutingAdapter {
  readonly provider: "FAKE" | "GOOGLE";
  route(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult>;
}

export type PlaceSuggestion = { placeId: string; label: string; secondary: string | null };

export interface PlacesAdapter {
  readonly provider: "FAKE" | "GOOGLE";
  search(query: string): Promise<PlaceSuggestion[] | null>; // null = service unavailable
  resolve(placeId: string): Promise<{ label: string; point: GeoPoint } | null>;
}
