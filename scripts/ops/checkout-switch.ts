// Incident switch for paid checkout (runbook "Provider or routing outage"). The normal
// control is the "Checkout open" setting at /staff/settings; this script is the fallback
// when the staff workspace is unavailable.
//
//   npm run ops:checkout -- pause  --env-file <path> --reason "pawaPay outage, incident 12"
//   npm run ops:checkout -- resume --env-file <path> --reason "Provider confirmed recovery"
//
// The target environment is always explicit (--env-file) and printed before anything is
// written; a local development database additionally needs --local (DB review D2).
//
// Writes a NEW settings version (settings are versioned and never edited in place) and an
// audit event. Pausing stops new payment starts immediately; unresolved payments keep
// being checked. Resuming does not bypass release gates: in production checkout stays
// closed while any publication block remains.
import { db } from "@/server/db";
import { now } from "@/modules/shared/clock";
import { operatingContext, publicationBlocks } from "@/modules/settings/settings";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function target(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main() {
  const action = process.argv.slice(2).find((a) => a === "pause" || a === "resume");
  const reason = arg("reason")?.trim();
  const envFile = arg("env-file");
  if (!action || !reason || !envFile) {
    console.error('usage: npm run ops:checkout -- pause|resume --env-file <path> --reason "<why>" [--local]');
    process.exit(1);
  }
  process.loadEnvFile(envFile);
  const appEnv = process.env.APP_ENV ?? "(unset)";
  const profile = await db().$queryRaw<{ environment: string }[]>`SELECT environment::text AS environment FROM commerce.deployment_profile WHERE id = 1`;
  console.log(`[ops] target: APP_ENV=${appEnv}, deployment profile=${profile[0]?.environment ?? "(none)"}, database=${target()}`);
  if (appEnv === "local" && !process.argv.includes("--local")) {
    console.error("[ops] refusing: this is a local development database. Pass --local if that is really what you want.");
    process.exit(1);
  }
  const enabled = action === "resume";
  const created = await db().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('settings_versions'))`;
    const latest = await tx.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
    if (latest.checkoutEnabled === enabled) return null;
    const { id: _id, version, createdAt: _createdAt, supportContact, ...rest } = latest;
    const next = await tx.settingsVersion.create({
      data: { ...rest, supportContact: supportContact ?? undefined, version: version + 1, checkoutEnabled: enabled, reason, createdByStaffId: null },
    });
    await tx.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        actorId: null,
        entityType: "settings",
        entityId: next.id,
        action: enabled ? "CHECKOUT_RESUMED" : "CHECKOUT_PAUSED",
        beforeSummary: { version, checkoutEnabled: latest.checkoutEnabled },
        afterSummary: { version: next.version, checkoutEnabled: enabled },
        reason: `ops script: ${reason}`,
        occurredAt: now(),
      },
    });
    return next;
  });
  if (!created) {
    console.log(`[ops] checkout is already ${enabled ? "enabled" : "paused"}; nothing changed.`);
    return;
  }
  const blocks = publicationBlocks(await operatingContext());
  console.log(`[ops] settings version ${created.version}: checkout ${enabled ? "enabled" : "paused"}.`);
  if (enabled && blocks.length > 0) console.log(`[ops] note: release blocks still apply in production: ${blocks.join(", ")}`);
}

main()
  .then(() => db().$disconnect())
  .catch(async (error) => {
    console.error("[ops] failed:", error instanceof Error ? error.message : error);
    await db().$disconnect();
    process.exit(1);
  });
