import "server-only";
import type { Db, Tx } from "@/server/db";
import { db } from "@/server/db";
import { serverEnv } from "@/server/env";
import type {
  DispatchLocation,
  SettingsVersion,
  Tariff,
} from "@/generated/prisma/client";
import { DomainError } from "@/modules/shared/errors";

export type OperatingContext = {
  settings: SettingsVersion;
  tariff: Tariff;
  location: DispatchLocation;
};

export async function currentSettings(
  client: Db | Tx = db(),
): Promise<SettingsVersion> {
  const settings = await client.settingsVersion.findFirst({
    orderBy: { version: "desc" },
  });
  if (!settings)
    throw new DomainError(
      "PROVIDER_UNAVAILABLE",
      "The shop is not configured yet.",
    );
  return settings;
}

export async function operatingContext(
  client: Db | Tx = db(),
): Promise<OperatingContext> {
  // Sequential on purpose: a transaction client runs one query at a time (pg warns on
  // concurrent queries on one connection).
  const settings = await currentSettings(client);
  const tariff = await client.tariff.findUniqueOrThrow({
    where: { id: settings.activeTariffId },
  });
  const location = await client.dispatchLocation.findUniqueOrThrow({
    where: { id: settings.activeLocationId },
  });
  return { settings, tariff, location };
}

export type PublicationBlock =
  | "CHECKOUT_DISABLED"
  | "TARIFF_NOT_APPROVED"
  | "ORIGIN_NOT_APPROVED"
  | "ORIGIN_INACTIVE"
  | "SETTINGS_NOT_VERIFIED"
  | "POLICIES_NOT_APPROVED"
  | "SUPPORT_CONTACT_MISSING"
  | "DELIVERY_PROMISE_MISSING"
  | "LIVE_PAYMENTS_DISABLED"
  | "PAYMENT_ADAPTER_NOT_LIVE"
  | "ROUTING_ADAPTER_NOT_LIVE"
  | "EMAIL_ADAPTER_NOT_LIVE";

/**
 * Server-owned list of reasons a public paid checkout must stay closed (G2-G5).
 * Recomputed on every read; a client-supplied list is never evidence.
 */
export function publicationBlocks(ctx: OperatingContext): PublicationBlock[] {
  const env = serverEnv();
  const blocks: PublicationBlock[] = [];
  if (!ctx.settings.checkoutEnabled) blocks.push("CHECKOUT_DISABLED");
  if (
    ctx.tariff.approvalState !== "APPROVED" ||
    ctx.tariff.dataOrigin !== "VERIFIED"
  )
    blocks.push("TARIFF_NOT_APPROVED");
  if (
    ctx.location.approvalState !== "APPROVED" ||
    ctx.location.dataOrigin !== "VERIFIED"
  )
    blocks.push("ORIGIN_NOT_APPROVED");
  if (!ctx.location.isActive) blocks.push("ORIGIN_INACTIVE");
  if (ctx.settings.dataOrigin !== "VERIFIED")
    blocks.push("SETTINGS_NOT_VERIFIED");
  if (!ctx.settings.policiesApproved) blocks.push("POLICIES_NOT_APPROVED");
  if (!ctx.settings.supportContact) blocks.push("SUPPORT_CONTACT_MISSING");
  if (!ctx.settings.deliveryPromise) blocks.push("DELIVERY_PROMISE_MISSING");
  if (!ctx.settings.livePaymentsEnabled) blocks.push("LIVE_PAYMENTS_DISABLED");
  if (env.PAYMENT_PROVIDER !== "pawapay")
    blocks.push("PAYMENT_ADAPTER_NOT_LIVE");
  if (
    env.ROUTING_PROVIDER !== "google" ||
    !env.GOOGLE_TWO_WHEELER_COVERAGE_APPROVED
  )
    blocks.push("ROUTING_ADAPTER_NOT_LIVE");
  // DR-057: e-mail is the launch channel for the order confirmation and private link.
  if (env.EMAIL_PROVIDER !== "resend") blocks.push("EMAIL_ADAPTER_NOT_LIVE");
  return blocks;
}

/**
 * Guard for quoting and payment initiation. In production every publication block
 * closes the sale flow. Elsewhere only the explicit checkout switch applies, so
 * synthetic rehearsals can run against fake adapters.
 */
export function assertSaleFlowOpen(ctx: OperatingContext): void {
  if (!ctx.settings.checkoutEnabled) {
    throw new DomainError(
      "PROVIDER_UNAVAILABLE",
      "Checkout is paused right now. Your basket is saved.",
    );
  }
  if (
    serverEnv().APP_ENV === "production" &&
    publicationBlocks(ctx).length > 0
  ) {
    throw new DomainError(
      "PROVIDER_UNAVAILABLE",
      "Checkout is not open yet. Your basket is saved.",
    );
  }
}

/** Kigali calendar date (YYYY-MM-DD) used for lot expiry comparisons. */
export function kigaliToday(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kigali" }).format(
    at,
  );
}
