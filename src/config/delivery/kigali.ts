import boundary from "./kigali-city.geojson.json";
import { parseCoverage } from "@/modules/delivery/coverage";

// Owner-confirmed map landmark; the physical pickup entrance still needs a rider check.
export const SILVERBACK_MALL = {
  label: "BeautyBOX · Silverback Mall, Kicukiro",
  addressText: "Silverback Mall, KK 15 Road, Kicukiro, Kigali, Rwanda",
  lat: -1.968846,
  lng: 30.102513,
};

export const KIGALI_COVERAGE = parseCoverage({
  type: "polygon",
  label: "City of Kigali · OpenStreetMap relation 1708283",
  polygon: boundary.geometry.coordinates[0]!.slice(0, -1).map(([lng, lat]) => [
    lat,
    lng,
  ]),
});

// Owner-authorized starting prices, to be revised against actual delivery expenses.
export const KIGALI_TARIFF = {
  baseRwf: 1500,
  includedMetres: 3000,
  extraRwfPerKm: 250,
  roundingRwf: 100,
  // An anomaly guard for circuitous routes, not a fare cap or a nationwide boundary.
  maxDistanceMetres: 100_000,
};
