// Copies the app's settings from a local settings file into the linked Vercel project
// (DR-044). Values go from the file to the Vercel CLI through standard input: they are never
// printed or passed as arguments. Owner/migration credentials are never sent.
//   vercel login            (the founder, once)
//   vercel link             (once, in this folder: choose the BeautyBOX project)
//   npx tsx scripts/ops/vercel-env-push.ts --env-file .env.staging.local --target production [--dry-run]
// Then redeploy: settings apply only to new deployments.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { arg, envValue, readEnvFile } from "../lib/env-file";

/** What the deployed app reads. Anything else in the file stays on this machine. */
const APP_SETTINGS = [
  "APP_ENV",
  "APP_ORIGIN",
  "DATABASE_URL",
  "DATABASE_POOL_MAX",
  "DATABASE_SSL",
  "DATABASE_SSL_CA",
  "DATA_ENCRYPTION_KEY",
  "TOKEN_HASH_SECRET",
  "WORKER_SECRET",
  "PAYMENT_PROVIDER",
  "PAWAPAY_MODE",
  "PAWAPAY_API_TOKEN",
  "PAWAPAY_SIGNING_PRIVATE_KEY",
  "PAWAPAY_SIGNING_KEY_ID",
  "ROUTING_PROVIDER",
  "SMS_PROVIDER",
  "DEMO_CATALOG_VISIBLE",
  "STAFF_AUTH_PROVIDER",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "MEDIA_STORAGE",
  "NEXT_PUBLIC_MEDIA_BASE_URL",
  "SUPABASE_PRIVATE_MEDIA_BUCKET",
  "SUPABASE_PUBLIC_MEDIA_BUCKET",
  "SITE_GATE",
  "SITE_ACCESS_CODE_HASH",
  "HOLDING_HOSTS",
  "LAUNCH_LIST",
  "LAUNCH_LIST_CONTACT_EMAIL",
] as const;

/** Stored as Vercel "Secret" values (not readable back in the dashboard or CLI). */
const SECRETS = new Set([
  "DATABASE_URL",
  "DATA_ENCRYPTION_KEY",
  "TOKEN_HASH_SECRET",
  "WORKER_SECRET",
  "PAWAPAY_API_TOKEN",
  "PAWAPAY_SIGNING_PRIVATE_KEY",
  "SUPABASE_SECRET_KEY",
  "SITE_ACCESS_CODE_HASH",
]);

/** Never leave this machine: the database owner, the raw runtime password, local-only switches. */
const NEVER = new Set(["STAGING_OWNER_DATABASE_URL", "MIGRATION_DATABASE_URL", "STAGING_RUNTIME_DB_PASSWORD", "PAWAPAY_BASE_URL", "NEXT_DIST_DIR", "NODE_ENV"]);

function vercel(args: string[], input?: string) {
  return spawnSync(process.platform === "win32" ? "vercel.cmd" : "vercel", args, { input, encoding: "utf8", shell: process.platform === "win32" });
}

function main() {
  const file = readEnvFile(arg("env-file") ?? ".env.staging.local");
  const target = arg("target") ?? "production";
  if (!["production", "preview", "development"].includes(target)) throw new Error("--target must be production, preview or development");
  if (!fs.existsSync(".vercel/project.json")) throw new Error("this folder is not linked to a Vercel project: run `vercel link` first");
  const dryRun = process.argv.includes("--dry-run");
  for (const name of NEVER) if (envValue(file, name) && (APP_SETTINGS as readonly string[]).includes(name)) throw new Error(`${name} must never be sent`);

  const sent: string[] = [];
  const skipped: string[] = [];
  for (const name of APP_SETTINGS) {
    const value = envValue(file, name);
    if (!value) {
      skipped.push(name);
      continue;
    }
    if (dryRun) {
      sent.push(`${name} (${value.length} chars)`);
      continue;
    }
    // --force replaces an existing value; the value itself only ever travels on standard input.
    const result = vercel(["env", "add", name, "--environment", target, "--force", "--yes", SECRETS.has(name) ? "--sensitive" : "--no-sensitive"], value);
    if (result.status !== 0) throw new Error(`could not set ${name} (the Vercel CLI said: ${(result.stderr || result.stdout).split(/\r?\n/).find((l) => l.trim()) ?? "no detail"})`);
    sent.push(`${name} (${value.length} chars${SECRETS.has(name) ? ", secret" : ""})`);
  }
  console.log(`[vercel-env] ${dryRun ? "would set" : "set"} for ${target}: ${sent.join(", ")}`);
  if (skipped.length > 0) console.log(`[vercel-env] not in the file, so not sent: ${skipped.join(", ")}`);
  if (!dryRun) console.log("[vercel-env] redeploy for the new settings to take effect.");
}

try {
  main();
} catch (error) {
  console.error("[vercel-env] failed:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
}
