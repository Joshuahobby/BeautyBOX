import "server-only";
import {
  GooglePlacesAdapter,
  GoogleRoutingAdapter,
} from "@/adapters/routing/google";
import type { GoogleTransport } from "@/adapters/routing/google-http";
import {
  SILVERBACK_MALL,
  KIGALI_COVERAGE,
  KIGALI_TARIFF,
} from "@/config/delivery/kigali";
import { isInsideCoverage } from "./coverage";
import { deliveryFeeRwf } from "./tariff";

export const PUBLIC_ROUTE_CASES = [
  ["kcc", "Kigali Convention Centre"],
  ["kimironko", "Kimironko Market Kigali"],
  ["nyabugogo", "Nyabugogo Bus Park Kigali"],
  ["amahoro", "Amahoro Stadium Kigali"],
  ["kicukiro", "Kicukiro Centre Kigali"],
  ["nyamirambo", "Nyamirambo Kigali"],
  ["airport", "Kigali International Airport"],
  ["gahanga", "Gahanga Cricket Stadium Kigali"],
  ["kabuga", "Kabuga Market Kigali"],
  ["rusororo", "Rusororo Kigali"],
  ["bumbogo", "Bumbogo Kigali"],
  ["ndera", "Ndera Kigali"],
] as const;

/** Public-landmark smoke check, not an automatic release approval. No DB or customer data. */
export async function checkGoogleDelivery(input: {
  routesKey: string;
  placesKey?: string;
  caseCount: number;
  transport?: GoogleTransport;
}) {
  if (
    !Number.isInteger(input.caseCount) ||
    input.caseCount < 1 ||
    input.caseCount > PUBLIC_ROUTE_CASES.length
  )
    throw new Error("Use 1 to 12 public cases.");
  let requests = 0;
  const bounded: GoogleTransport = async (url, options) => {
    if (requests >= Math.min(36, input.caseCount * 3))
      throw new Error("Diagnostic request budget reached");
    requests++;
    return (input.transport ?? fetch)(url, options);
  };
  const places = new GooglePlacesAdapter(
    input.placesKey ?? input.routesKey,
    bounded,
  );
  // This explicit diagnostic bypasses only the adapter evidence gate, not app settings.
  const routing = new GoogleRoutingAdapter(input.routesKey, true, bounded);
  const cases: { id: string; outcome: string; feeRwf?: number }[] = [];
  let stopped = false;
  for (const [id, query] of PUBLIC_ROUTE_CASES.slice(0, input.caseCount)) {
    const suggestions = await places.search(query);
    if (!suggestions?.length) {
      cases.push({
        id,
        outcome: suggestions === null ? "PLACES_UNAVAILABLE" : "NO_MATCH",
      });
      stopped = true;
      break;
    }
    const selected = await places.resolve(suggestions[0]!.placeId);
    if (!selected) {
      cases.push({ id, outcome: "PLACE_UNRESOLVED" });
      stopped = true;
      break;
    }
    if (!isInsideCoverage(selected.point, KIGALI_COVERAGE)) {
      cases.push({ id, outcome: "OUTSIDE_KIGALI" });
      continue;
    }
    const route = await routing.route(SILVERBACK_MALL, selected.point);
    if (route.kind === "UNAVAILABLE") {
      cases.push({ id, outcome: "ROUTING_UNAVAILABLE" });
      stopped = true;
      break;
    }
    if (route.kind === "NO_ROUTE") {
      cases.push({ id, outcome: "NO_MOTORCYCLE_ROUTE" });
      continue;
    }
    if (route.distanceMetres > KIGALI_TARIFF.maxDistanceMetres) {
      cases.push({ id, outcome: "ROUTE_ANOMALY" });
      continue;
    }
    cases.push({
      id,
      outcome: "ROUTED",
      feeRwf: deliveryFeeRwf(route.distanceMetres, KIGALI_TARIFF),
    });
  }
  const outsideBlocked = !isInsideCoverage(
    { lat: -1.499646, lng: 29.634962 },
    KIGALI_COVERAGE,
  );
  return {
    checkedAt: new Date().toISOString(),
    requests,
    maximumRequests: Math.min(36, input.caseCount * 3),
    stoppedOnFailure: stopped,
    cases,
    outsideCityRejectedLocally: outsideBlocked,
    settingsChanged: false,
    note: "Public landmark smoke check. The first suggestion was used; independently review destination identity, dispatch entrance and coverage before release approval. No raw road distance or coordinates retained.",
  };
}
