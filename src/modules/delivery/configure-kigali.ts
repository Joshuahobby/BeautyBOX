import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/db";
import { serverEnv } from "@/server/env";
import { operatingContext } from "@/modules/settings/settings";
import { DomainError } from "@/modules/shared/errors";
import {
  SILVERBACK_MALL,
  KIGALI_COVERAGE,
  KIGALI_TARIFF,
} from "@/config/delivery/kigali";
import { coverageRulesSchema } from "./coverage";

function sameCoverage(value: unknown): boolean {
  const parsed = coverageRulesSchema.safeParse(value);
  return (
    parsed.success &&
    parsed.data.label === KIGALI_COVERAGE.label &&
    JSON.stringify(parsed.data.polygon) ===
      JSON.stringify(KIGALI_COVERAGE.polygon)
  );
}

/** Explicit local/test rehearsal only. Does not alter release gates or hosted settings. */
export async function configureKigali(input: {
  apply: boolean;
  expectedVersion?: number;
}) {
  const env = serverEnv();
  if (
    !["local", "test"].includes(env.APP_ENV) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(env.DATABASE_URL).hostname,
    )
  ) {
    throw new Error(
      "Kigali configuration rehearsal is restricted to a loopback local/test database.",
    );
  }
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('settings_versions'))`;
    const profiles = await tx.$queryRaw<
      { environment: string }[]
    >`SELECT environment::text AS environment FROM commerce.deployment_profile WHERE id = 1`;
    if (!profiles[0] || !["LOCAL", "TEST"].includes(profiles[0].environment))
      throw new Error("Local/test database profile required.");
    const ctx = await operatingContext(tx);
    if (input.apply && ctx.settings.version !== input.expectedVersion)
      throw new DomainError(
        "VERSION_CONFLICT",
        "Reload the current settings version before applying Kigali configuration.",
      );
    const originChanged =
      Number(ctx.location.lat) !== SILVERBACK_MALL.lat ||
      Number(ctx.location.lng) !== SILVERBACK_MALL.lng ||
      ctx.location.label !== SILVERBACK_MALL.label ||
      ctx.location.addressText !== SILVERBACK_MALL.addressText;
    const tariffChanged =
      Number(ctx.tariff.baseRwf) !== KIGALI_TARIFF.baseRwf ||
      ctx.tariff.includedMetres !== KIGALI_TARIFF.includedMetres ||
      Number(ctx.tariff.extraRwfPerKm) !== KIGALI_TARIFF.extraRwfPerKm ||
      Number(ctx.tariff.roundingRwf) !== KIGALI_TARIFF.roundingRwf ||
      ctx.tariff.maxDistanceMetres !== KIGALI_TARIFF.maxDistanceMetres ||
      !sameCoverage(ctx.tariff.coverageRules);
    const beforeVersion = ctx.settings.version;
    if (!input.apply || (!originChanged && !tariffChanged))
      return {
        applied: false,
        version: beforeVersion,
        originChanged,
        tariffChanged,
        vertices: KIGALI_COVERAGE.polygon.length,
      };
    if (originChanged)
      await tx.dispatchLocation.update({
        where: { id: ctx.location.id },
        data: {
          ...SILVERBACK_MALL,
          version: { increment: 1 },
          approvalState: "PROPOSED",
          dataOrigin: "VERIFIED",
        },
      });
    let tariffId = ctx.tariff.id;
    if (tariffChanged) {
      const latest = await tx.tariff.findFirstOrThrow({
        orderBy: { version: "desc" },
      });
      const tariff = await tx.tariff.create({
        data: {
          ...KIGALI_TARIFF,
          baseRwf: BigInt(KIGALI_TARIFF.baseRwf),
          extraRwfPerKm: BigInt(KIGALI_TARIFF.extraRwfPerKm),
          roundingRwf: BigInt(KIGALI_TARIFF.roundingRwf),
          version: latest.version + 1,
          coverageRules: KIGALI_COVERAGE,
          approvalState: "PROPOSED",
          dataOrigin: "VERIFIED",
          reason:
            "Owner-selected Kigali starting prices; live motorcycle coverage evidence pending",
        },
      });
      tariffId = tariff.id;
    }
    const {
      id: _id,
      version,
      createdAt: _created,
      supportContact,
      ...rest
    } = ctx.settings;
    const next = await tx.settingsVersion.create({
      data: {
        ...rest,
        version: version + 1,
        supportContact: supportContact ?? Prisma.DbNull,
        activeTariffId: tariffId,
        reason: "Local Kigali delivery configuration rehearsal",
        createdByStaffId: null,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "settings",
        entityId: next.id,
        action: "KIGALI_DELIVERY_CONFIGURED",
        beforeSummary: { version: beforeVersion },
        afterSummary: {
          version: next.version,
          originChanged,
          tariffChanged,
          vertices: KIGALI_COVERAGE.polygon.length,
        },
        reason:
          "Owner-selected Silverback Mall origin and starting tariff; no release gates changed",
      },
    });
    return {
      applied: true,
      version: next.version,
      originChanged,
      tariffChanged,
      vertices: KIGALI_COVERAGE.polygon.length,
    };
  });
}

export const disconnectDeliveryConfiguration = () => db().$disconnect();
