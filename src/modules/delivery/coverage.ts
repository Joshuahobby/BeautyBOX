import { z } from "zod";
import type { GeoPoint } from "@/adapters/routing/types";

// Service coverage (DEL-01/DEL-04): an explicit polygon configured with the tariff.
// Being inside the polygon is necessary but not sufficient: the routed distance must
// also be within the tariff's maximum distance.

export const coverageRulesSchema = z.object({
  type: z.literal("polygon"),
  label: z.string().min(1),
  // [lat, lng] vertices, at least a triangle; the ring closes implicitly.
  polygon: z
    .array(
      z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]),
    )
    .min(3)
    .max(2048),
});

export type CoverageRules = z.infer<typeof coverageRulesSchema>;

export function parseCoverage(value: unknown): CoverageRules {
  return coverageRulesSchema.parse(value);
}

/** Ray casting point-in-polygon on lat/lng (adequate for city-scale polygons). */
export function isInsideCoverage(
  point: GeoPoint,
  rules: CoverageRules,
): boolean {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
  const ring = rules.polygon;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]!;
    const [yj, xj] = ring[j]!;
    // Include the boundary itself; allow a small floating-point tolerance.
    const dx = xj - xi,
      dy = yj - yi;
    const cross = (point.lng - xi) * dy - (point.lat - yi) * dx;
    if (
      Math.abs(cross) <= 1e-12 * Math.max(1, Math.abs(dx), Math.abs(dy)) &&
      point.lng >= Math.min(xi, xj) - 1e-10 &&
      point.lng <= Math.max(xi, xj) + 1e-10 &&
      point.lat >= Math.min(yi, yj) - 1e-10 &&
      point.lat <= Math.max(yi, yj) + 1e-10
    )
      return true;
    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
