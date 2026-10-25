import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Tx } from "@/server/db";
import { serverEnv } from "@/server/env";
import { DomainError } from "@/modules/shared/errors";
import { toRwf } from "@/modules/shared/money";
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from "@/modules/idempotency/idempotency";
import { audit } from "@/modules/audit/audit";
import { can } from "@/modules/staff/capabilities";
import type { StaffIdentity } from "@/modules/staff/identity";
import { coverageRulesSchema, type CoverageRules } from "@/modules/delivery/coverage";
import { operatingContext, publicationBlocks, type OperatingContext } from "./settings";

// A07 settings (contract getSettings / updateSettings). Every change writes NEW versions:
// a new settings row; a new immutable tariff row when the tariff or coverage changes; a
// new dispatch-location version when the pin, hours or parcel limits change. Quotes are
// bound to tariff and origin versions, so they go stale automatically and must be
// re-quoted; placed orders keep their own snapshot ("no retroactive order changes").
// publicationBlocks are always recomputed by the server and never accepted from input.

type Point = { lat: number; lng: number };
type GeoPolygon = { type: "Polygon"; coordinates: [number, number][][] };

export type SettingsView = {
  version: number;
  origin: Point | null;
  originLabel: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
  dispatchHours: string | null;
  deliveryPromise: string | null;
  coverageGeoJson: GeoPolygon | null;
  tariff: { baseRwf: number; includedMetres: number; extraRwfPerKm: number; roundingRwf: number; version: number; approved: boolean } | null;
  checkoutEnabled: boolean;
  livePaymentsEnabled: boolean;
  publicationBlocks: string[];
  parcelLimits: { maxWeightGrams: number | null; maxItems: number; allowedClasses: string[] } | null;
  quoteTtlSeconds: number;
  // Additions (CC-16): the approvals that clear ORIGIN_NOT_APPROVED / POLICIES_NOT_APPROVED.
  originApproved: boolean;
  policiesApproved: boolean;
};

export type SettingsInput = Omit<SettingsView, "version" | "publicationBlocks" | "tariff" | "coverageGeoJson"> & {
  version?: number;
  /** Validated server-side: one GeoJSON Polygon ([lng, lat]) inside Rwanda. */
  coverageGeoJson: Record<string, unknown> | null;
  publicationBlocks?: string[];
  tariff: (Omit<NonNullable<SettingsView["tariff"]>, "version"> & { version?: number }) | null;
};

type ParcelRules = { maxTotalUnits: number; maxWeightGrams?: number | null; allowedClasses?: string[] };

function toGeoJson(rules: CoverageRules): GeoPolygon {
  const ring = rules.polygon.map(([lat, lng]) => [lng, lat] as [number, number]);
  return { type: "Polygon", coordinates: [[...ring, ring[0]!]] };
}

/** GeoJSON Polygon (one outer ring, [lng, lat]) -> internal [lat, lng] polygon. */
function fromGeoJson(value: unknown, label: string): CoverageRules {
  const fail = (message: string) => new DomainError("VALIDATION_ERROR", message, { fieldErrors: [{ field: "settings.coverageGeoJson", message }] });
  const g = value as { type?: unknown; coordinates?: unknown };
  let rings: unknown;
  if (g?.type === "Polygon") rings = g.coordinates;
  else if (g?.type === "MultiPolygon" && Array.isArray(g.coordinates) && g.coordinates.length === 1) rings = g.coordinates[0];
  else throw fail("Use one GeoJSON Polygon for the delivery area.");
  if (!Array.isArray(rings) || rings.length !== 1) throw fail("The delivery area must be one outer boundary without holes.");
  const ring = rings[0] as unknown[];
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > 501) throw fail("The boundary needs 3 to 500 points.");
  const points = ring.map((p) => {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== "number" || typeof p[1] !== "number") throw fail("Each point must be [longitude, latitude].");
    return [p[1], p[0]] as [number, number];
  });
  const [first, last] = [points[0]!, points[points.length - 1]!];
  if (first[0] === last[0] && first[1] === last[1]) points.pop();
  const parsed = coverageRulesSchema.safeParse({ type: "polygon", label, polygon: points });
  if (!parsed.success) throw fail("Points must be valid latitude/longitude values.");
  // Rwanda bounding box sanity check: a pin or area outside it is almost certainly a typo.
  if (points.some(([lat, lng]) => lat < -2.9 || lat > -1.0 || lng < 28.8 || lng > 31.0)) throw fail("The delivery area must lie within Rwanda.");
  return parsed.data;
}

function parcelRules(location: { parcelRules: unknown }): ParcelRules {
  const r = (location.parcelRules ?? {}) as Partial<ParcelRules>;
  return { maxTotalUnits: Number(r.maxTotalUnits ?? 0), maxWeightGrams: r.maxWeightGrams ?? null, allowedClasses: r.allowedClasses ?? ["STANDARD"] };
}

export function settingsView(ctx: OperatingContext): SettingsView {
  const contact = (ctx.settings.supportContact ?? {}) as { phone?: string; email?: string };
  const hours = (ctx.location.hours ?? null) as { text?: string } | null;
  const coverage = coverageRulesSchema.safeParse(ctx.tariff.coverageRules);
  const parcel = parcelRules(ctx.location);
  return {
    version: ctx.settings.version,
    origin: { lat: Number(ctx.location.lat), lng: Number(ctx.location.lng) },
    originLabel: ctx.location.label,
    supportPhone: contact.phone ?? null,
    supportEmail: contact.email ?? null,
    dispatchHours: hours?.text ?? null,
    deliveryPromise: ctx.settings.deliveryPromise,
    coverageGeoJson: coverage.success ? toGeoJson(coverage.data) : null,
    tariff: {
      baseRwf: toRwf(ctx.tariff.baseRwf),
      includedMetres: ctx.tariff.includedMetres,
      extraRwfPerKm: toRwf(ctx.tariff.extraRwfPerKm),
      roundingRwf: toRwf(ctx.tariff.roundingRwf),
      version: ctx.tariff.version,
      approved: ctx.tariff.approvalState === "APPROVED" && ctx.tariff.dataOrigin === "VERIFIED",
    },
    checkoutEnabled: ctx.settings.checkoutEnabled,
    livePaymentsEnabled: ctx.settings.livePaymentsEnabled,
    publicationBlocks: publicationBlocks(ctx),
    parcelLimits: parcel.maxTotalUnits > 0 ? { maxWeightGrams: parcel.maxWeightGrams ?? null, maxItems: parcel.maxTotalUnits, allowedClasses: parcel.allowedClasses ?? ["STANDARD"] } : null,
    quoteTtlSeconds: ctx.settings.quoteTtlSeconds,
    originApproved: ctx.location.approvalState === "APPROVED" && ctx.location.dataOrigin === "VERIFIED",
    policiesApproved: ctx.settings.policiesApproved,
  };
}

export async function getSettings(staff: StaffIdentity): Promise<SettingsView> {
  if (!can(staff.role, "settings.read")) throw new DomainError("FORBIDDEN", "Your role cannot view settings.");
  return settingsView(await operatingContext());
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function isProductionProfile(tx: Tx): Promise<boolean> {
  if (serverEnv().APP_ENV === "production") return true;
  const rows = await tx.$queryRaw<{ environment: string }[]>`SELECT environment::text AS environment FROM commerce.deployment_profile WHERE id = 1`;
  return rows[0]?.environment === "PRODUCTION";
}

export async function updateSettings(
  staff: StaffIdentity,
  input: { expectedVersion: number; settings: SettingsInput; reason: string },
  key: string,
  requestId: string | null,
): Promise<SettingsView> {
  if (!can(staff.role, "settings.write")) throw new DomainError("FORBIDDEN", "Only an administrator can change settings.");
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("VALIDATION_ERROR", "Give a reason for the change.", { fieldErrors: [{ field: "reason", message: "Required." }] });
  const s = input.settings;
  const fieldErrors: { field: string; message: string }[] = [];
  if (!s.origin) fieldErrors.push({ field: "settings.origin", message: "Set the dispatch pin." });
  if (!s.originLabel?.trim()) fieldErrors.push({ field: "settings.originLabel", message: "Name the dispatch point." });
  if (!s.tariff) fieldErrors.push({ field: "settings.tariff", message: "A delivery tariff is required." });
  if (!s.coverageGeoJson) fieldErrors.push({ field: "settings.coverageGeoJson", message: "A delivery area is required." });
  if (s.origin && (s.origin.lat < -2.9 || s.origin.lat > -1.0 || s.origin.lng < 28.8 || s.origin.lng > 31.0)) {
    fieldErrors.push({ field: "settings.origin", message: "The dispatch pin must be in Rwanda." });
  }
  if (s.parcelLimits && s.parcelLimits.allowedClasses.some((c) => c !== "STANDARD")) {
    fieldErrors.push({ field: "settings.parcelLimits.allowedClasses", message: "Only standard parcels are delivered at launch; bulky items need special delivery." });
  }
  if (fieldErrors.length) throw new DomainError("VALIDATION_ERROR", "Check the highlighted settings.", { fieldErrors });

  await transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, { scope: `staff:${staff.staffId}:settings`, key, requestHash: requestHash("updateSettings", input) });
    if (claim.kind === "REPLAY") return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('settings_versions'))`;
    const ctx = await operatingContext(tx);
    if (ctx.settings.version !== input.expectedVersion) throw new DomainError("VERSION_CONFLICT", "Settings changed since you opened them. Reload to see the current values.");
    const before = settingsView(ctx);
    const coverage = fromGeoJson(s.coverageGeoJson, before.coverageGeoJson && same(before.coverageGeoJson, s.coverageGeoJson) ? parseLabel(ctx) : "Delivery area");
    const t = s.tariff!;

    // Production safety: switching payments or checkout on is refused while any other
    // release block would remain (the gates are evidence, not toggles).
    const production = await isProductionProfile(tx);

    // 1. Tariff + coverage: immutable rows, new version on any change.
    let tariffId = ctx.tariff.id;
    const tariffChanged =
      t.baseRwf !== toRwf(ctx.tariff.baseRwf) ||
      t.includedMetres !== ctx.tariff.includedMetres ||
      t.extraRwfPerKm !== toRwf(ctx.tariff.extraRwfPerKm) ||
      t.roundingRwf !== toRwf(ctx.tariff.roundingRwf) ||
      t.approved !== before.tariff!.approved ||
      !same(toGeoJson(coverage), before.coverageGeoJson);
    if (tariffChanged) {
      const latest = await tx.tariff.findFirstOrThrow({ orderBy: { version: "desc" } });
      const created = await tx.tariff.create({
        data: {
          version: latest.version + 1,
          baseRwf: BigInt(t.baseRwf),
          includedMetres: t.includedMetres,
          extraRwfPerKm: BigInt(t.extraRwfPerKm),
          roundingRwf: BigInt(t.roundingRwf),
          maxDistanceMetres: ctx.tariff.maxDistanceMetres,
          coverageRules: coverage,
          approvalState: t.approved ? "APPROVED" : "PROPOSED",
          dataOrigin: "VERIFIED",
          reason,
          createdByStaffId: staff.staffId,
        },
      });
      tariffId = created.id;
    }

    // 2. Dispatch point: same physical location (stock lots stay attached), new version.
    const parcel = parcelRules(ctx.location);
    const nextParcel: ParcelRules = s.parcelLimits
      ? { maxTotalUnits: s.parcelLimits.maxItems, maxWeightGrams: s.parcelLimits.maxWeightGrams, allowedClasses: s.parcelLimits.allowedClasses }
      : parcel;
    const originChanged =
      s.origin!.lat !== Number(ctx.location.lat) ||
      s.origin!.lng !== Number(ctx.location.lng) ||
      s.originLabel!.trim() !== ctx.location.label ||
      (s.dispatchHours?.trim() || null) !== before.dispatchHours ||
      !same(nextParcel, parcel) ||
      s.originApproved !== before.originApproved;
    if (originChanged) {
      await tx.dispatchLocation.update({
        where: { id: ctx.location.id },
        data: {
          lat: s.origin!.lat,
          lng: s.origin!.lng,
          label: s.originLabel!.trim(),
          hours: s.dispatchHours?.trim() ? { text: s.dispatchHours.trim() } : Prisma.DbNull,
          parcelRules: nextParcel,
          approvalState: s.originApproved ? "APPROVED" : "PROPOSED",
          dataOrigin: "VERIFIED",
          version: { increment: 1 },
        },
      });
    }

    // 3. Settings row (always a new version).
    const supportContact = s.supportPhone || s.supportEmail ? { ...(s.supportPhone ? { phone: s.supportPhone } : {}), ...(s.supportEmail ? { email: s.supportEmail } : {}) } : undefined;
    const { id: _id, version, createdAt: _c, supportContact: _sc, ...rest } = ctx.settings;
    const next = await tx.settingsVersion.create({
      data: {
        ...rest,
        version: version + 1,
        activeTariffId: tariffId,
        checkoutEnabled: s.checkoutEnabled,
        livePaymentsEnabled: s.livePaymentsEnabled,
        quoteTtlSeconds: s.quoteTtlSeconds,
        deliveryPromise: s.deliveryPromise?.trim() || null,
        supportContact,
        policiesApproved: s.policiesApproved,
        dataOrigin: "VERIFIED",
        reason,
        createdByStaffId: staff.staffId,
      },
    });

    const after = settingsView(await operatingContext(tx));
    if (production && (s.livePaymentsEnabled || s.checkoutEnabled)) {
      const others = after.publicationBlocks.filter((b) => b !== "CHECKOUT_DISABLED" && b !== "LIVE_PAYMENTS_DISABLED");
      if (others.length > 0) {
        throw new DomainError("PUBLICATION_BLOCKED", "Checkout and live payments stay off until every release block is cleared.", {
          fieldErrors: others.map((b) => ({ field: "publicationBlocks", message: b })),
        });
      }
    }
    await audit(tx, {
      actor: { type: "STAFF", id: staff.staffId },
      entityType: "settings",
      entityId: next.id,
      action: "SETTINGS_UPDATED",
      before: { ...before, publicationBlocks: undefined },
      after: { ...after, publicationBlocks: after.publicationBlocks },
      reason,
      requestId,
    });
    await completeIdempotencyKey(tx, claim.recordId, { resourceType: "settings_version", resourceId: next.id, responseStatus: 200 });
  });
  return settingsView(await operatingContext(db()));
}

function parseLabel(ctx: OperatingContext): string {
  const parsed = coverageRulesSchema.safeParse(ctx.tariff.coverageRules);
  return parsed.success ? parsed.data.label : "Delivery area";
}
