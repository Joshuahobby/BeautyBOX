import "server-only";
import { z } from "zod";
import type {
  GeoPoint,
  PlacesAdapter,
  RoutingAdapter,
  RouteResult,
} from "./types";
import { googleJson, type GoogleTransport } from "./google-http";
import { SILVERBACK_MALL } from "@/config/delivery/kigali";

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const shortText = (value: string) => value.trim().slice(0, 200);

export class GooglePlacesAdapter implements PlacesAdapter {
  readonly provider = "GOOGLE" as const;
  constructor(
    private readonly key: string,
    private readonly transport: GoogleTransport = fetch,
  ) {}

  async search(query: string) {
    const input = query.trim().slice(0, 80);
    if (input.length < 2) return [];
    const response = await googleJson(
      "https://places.googleapis.com/v1/places:autocomplete",
      this.key,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-FieldMask":
            "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
        },
        body: JSON.stringify({
          input,
          includedRegionCodes: ["rw"],
          languageCode: "en",
          includeQueryPredictions: false,
          locationBias: {
            circle: {
              center: {
                latitude: SILVERBACK_MALL.lat,
                longitude: SILVERBACK_MALL.lng,
              },
              radius: 30000,
            },
          },
        }),
      },
      this.transport,
    );
    if (!response.ok) return null;
    const parsed = z
      .object({
        suggestions: z
          .array(
            z.object({
              placePrediction: z
                .object({
                  placeId: idSchema,
                  text: z.object({ text: z.string().min(1) }),
                  structuredFormat: z
                    .object({
                      mainText: z.object({ text: z.string() }),
                      secondaryText: z.object({ text: z.string() }).optional(),
                    })
                    .optional(),
                })
                .optional(),
            }),
          )
          .max(50)
          .optional(),
      })
      .safeParse(response.value);
    if (!parsed.success) return null;
    return (parsed.data.suggestions ?? [])
      .flatMap((s) =>
        s.placePrediction
          ? [
              {
                placeId: s.placePrediction.placeId,
                label: shortText(
                  s.placePrediction.structuredFormat?.mainText.text ||
                    s.placePrediction.text.text,
                ),
                secondary: s.placePrediction.structuredFormat?.secondaryText
                  ? shortText(
                      s.placePrediction.structuredFormat.secondaryText.text,
                    )
                  : null,
              },
            ]
          : [],
      )
      .slice(0, 8);
  }

  async resolve(placeId: string) {
    if (!idSchema.safeParse(placeId).success) return null;
    const response = await googleJson(
      "https://places.googleapis.com/v1/places/" + encodeURIComponent(placeId),
      this.key,
      {
        method: "GET",
        headers: {
          "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
        },
      },
      this.transport,
    );
    if (!response.ok) return null;
    const parsed = z
      .object({
        id: idSchema,
        displayName: z.object({ text: z.string().min(1) }).optional(),
        formattedAddress: z.string().optional(),
        location: z.object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
        }),
      })
      .safeParse(response.value);
    if (!parsed.success || parsed.data.id !== placeId) return null;
    const label = shortText(
      parsed.data.displayName?.text ||
        parsed.data.formattedAddress ||
        "Selected place",
    );
    return {
      label,
      point: {
        lat: parsed.data.location.latitude,
        lng: parsed.data.location.longitude,
      },
    };
  }
}

export class GoogleRoutingAdapter implements RoutingAdapter {
  readonly provider = "GOOGLE" as const;
  constructor(
    private readonly key: string,
    private readonly coverageApproved: boolean,
    private readonly transport: GoogleTransport = fetch,
  ) {}

  async route(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult> {
    if (!this.coverageApproved)
      return {
        kind: "UNAVAILABLE",
        reason: "Motorcycle routing coverage evidence pending",
      };
    if (
      !pointSchema.safeParse(origin).success ||
      !pointSchema.safeParse(destination).success
    )
      return { kind: "UNAVAILABLE", reason: "Invalid routing point" };
    const waypoint = (p: GeoPoint) => ({
      location: { latLng: { latitude: p.lat, longitude: p.lng } },
    });
    const response = await googleJson(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      this.key,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
        },
        body: JSON.stringify({
          origin: waypoint(origin),
          destination: waypoint(destination),
          travelMode: "TWO_WHEELER",
          routingPreference: "TRAFFIC_UNAWARE",
          computeAlternativeRoutes: false,
          units: "METRIC",
        }),
      },
      this.transport,
    );
    if (!response.ok)
      return {
        kind: "UNAVAILABLE",
        reason: "Motorcycle routing service unavailable",
      };
    const parsed = z
      .object({
        routes: z
          .array(
            z.object({
              distanceMeters: z.number().int().min(0).max(10_000_000),
              duration: z
                .string()
                .regex(/^\d+(?:\.\d+)?s$/)
                .optional(),
            }),
          )
          .max(10)
          .optional(),
      })
      .safeParse(response.value);
    if (!parsed.success)
      return {
        kind: "UNAVAILABLE",
        reason: "Invalid motorcycle routing response",
      };
    const route = parsed.data.routes?.[0];
    if (!route) return { kind: "NO_ROUTE" };
    return {
      kind: "OK",
      distanceMetres: route.distanceMeters,
      durationSeconds: route.duration
        ? Math.ceil(Number(route.duration.slice(0, -1)))
        : null,
      attribution: "Google Maps",
      evidenceRef: null,
    };
  }
}
