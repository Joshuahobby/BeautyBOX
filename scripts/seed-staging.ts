// Staging shop configuration and SYNTHETIC catalog (DR-044). Runs against the staging database
// with the staging settings file, from the operator's machine (staging-bootstrap.ts --seed):
//   npx tsx --conditions=react-server --env-file=.env.staging.local scripts/seed-staging.ts
// Refused unless APP_ENV=staging and the database profile says STAGING with demo data allowed
// (scripts/ops/staging-bootstrap.ts sets that up). Only invented SYNTHETIC_DEMO products are
// added: no design-reference brands, no real stock or prices. Safe to run again: it adds only
// what is missing, so it also finishes a run that was interrupted.
import { db } from "@/server/db";
import { assertFixturesAllowed, seedBaseConfiguration } from "@/modules/dev/fixtures";
import { ensureSyntheticCatalog } from "@/modules/dev/synthetic-catalog";

async function shopBase(): Promise<{ sellerId: string; locationId: string }> {
  // The base configuration (seller, dispatch point, tariff, settings) is created in one
  // transaction, so it is either all there or not there at all.
  const current = await db().settingsVersion.findFirst({ orderBy: { version: "desc" } });
  if (current) {
    const location = await db().dispatchLocation.findUniqueOrThrow({ where: { id: current.activeLocationId } });
    return { sellerId: location.sellerId, locationId: location.id };
  }
  // No SMS provider in staging yet, so customer notifications stay off.
  const { seller, location } = await seedBaseConfiguration({ staging: true, notificationsEnabled: false, kigaliDelivery: true });
  console.log("[seed-staging] shop configuration added");
  return { sellerId: seller.id, locationId: location.id };
}

async function main() {
  await assertFixturesAllowed({ staging: true });
  const result = await ensureSyntheticCatalog(await shopBase());
  console.log(
    `[seed-staging] ready: ${await db().product.count()} products, ${await db().category.count()} categories` +
      ` (this run added ${result.categoriesAdded} categories and ${result.productsAdded} products, and finished ${result.productsCompleted})`,
  );
}

main()
  .then(() => db().$disconnect())
  .catch(async (error) => {
    console.error("[seed-staging] failed:", error instanceof Error ? error.message : error);
    await db().$disconnect();
    process.exit(1);
  });
