// Prepares the STAGING database (DR-044) from the operator's machine, using the settings file.
// Every step is safe to repeat. Secrets go into the file, never to the screen: output is names,
// counts and yes/no only.
//
//   npm run staging:bootstrap -- [--prepare] [--copy-from .env.local] [--ca-file <certificate.crt>] [--seed] [--scheduler]
//   (reads .env.staging.local; another file with --env-file <path>)
//
// --copy-from: copies the pawaPay SANDBOX token and signing key and the Supabase keys from the
//   local settings file into empty lines of the staging file (names only are shown).
// --ca-file:   stores Supabase's database certificate (downloaded from the dashboard) on one line.
// --prepare:   only fills in the settings file (secrets generated, DATABASE_URL written) and lists
//   what is still missing; no database work. Without it, a database password missing from
//   STAGING_OWNER_DATABASE_URL is asked for at a hidden prompt and saved.
//
// Needs in the file: APP_ENV=staging, APP_ORIGIN, and STAGING_OWNER_DATABASE_URL (the Supabase
// "postgres" user through the session pooler, port 5432; typed in by the founder). Then:
//  1. generates DATA_ENCRYPTION_KEY, TOKEN_HASH_SECRET, WORKER_SECRET and the runtime role's password if missing;
//  2. creates the runtime login role, the group role, the commerce schema and default privileges;
//  3. applies the migrations (prisma migrate deploy, as the owner);
//  4. records the database profile STAGING (demo data allowed) and closes Prisma's history table to the Data API;
//  5. writes DATABASE_URL for the app (runtime role through the transaction pooler, port 6543);
//  --seed:      adds the staging shop configuration and synthetic catalog (scripts/seed-staging.ts);
//  --scheduler: every minute, Supabase Cron calls POST /api/v1/internal/jobs/run with WORKER_SECRET from Vault.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { arg, envValue, promptHidden, readEnvFile, setEnvValues, type EnvFile } from "../lib/env-file";

const APP_ROLE = "beautybox_app";
const OWNER_ROLE = "postgres";
const JOB_NAME = "beautybox-jobs-run";
const CLEANUP_JOB = "beautybox-cron-history-cleanup";
const VAULT_NAME = "beautybox_worker_secret";

function say(message: string) {
  console.log(`[staging] ${message}`);
}

function generateMissing(file: EnvFile) {
  const generated: Record<string, string> = {};
  if (!envValue(file, "DATA_ENCRYPTION_KEY")) generated.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  if (!envValue(file, "TOKEN_HASH_SECRET")) generated.TOKEN_HASH_SECRET = randomBytes(48).toString("base64url");
  if (!envValue(file, "WORKER_SECRET")) generated.WORKER_SECRET = randomBytes(48).toString("base64url");
  if (!envValue(file, "STAGING_RUNTIME_DB_PASSWORD")) generated.STAGING_RUNTIME_DB_PASSWORD = randomBytes(32).toString("base64url");
  if (Object.keys(generated).length > 0) {
    setEnvValues(file, generated);
    say(`generated and saved: ${Object.keys(generated).join(", ")}`);
  }
}

function tls(file: EnvFile): pg.ClientConfig["ssl"] {
  const ca = envValue(file, "DATABASE_SSL_CA");
  return ca ? { rejectUnauthorized: true, ca: ca.replace(/\\n/g, "\n") } : { rejectUnauthorized: false };
}

/** Supabase pooler user names are "<role>.<project-ref>". */
function poolerParts(ownerUrl: string) {
  const url = new URL(ownerUrl);
  const user = decodeURIComponent(url.username);
  const ref = user.startsWith(`${OWNER_ROLE}.`) ? user.slice(OWNER_ROLE.length + 1) : null;
  if (!ref || !/^[a-z0-9]+$/.test(ref) || !url.hostname.endsWith(".pooler.supabase.com")) {
    throw new Error("STAGING_OWNER_DATABASE_URL must be the Supabase session pooler URL (user postgres.<project-ref>, host *.pooler.supabase.com, port 5432)");
  }
  if (url.port !== "5432") {
    // Port 6543 is the transaction pooler: migrations need a session (locks, prepared statements).
    throw new Error("STAGING_OWNER_DATABASE_URL must use the session pooler, port 5432 (not the transaction pooler on 6543)");
  }
  return { url, ref };
}

/** Whether the app's own connection (DATABASE_URL in the file) already logs in. */
async function runtimeLoginWorks(file: EnvFile): Promise<boolean> {
  const url = envValue(file, "DATABASE_URL");
  if (!url) return false;
  const probe = new pg.Client({ connectionString: url, ssl: tls(file), connectionTimeoutMillis: 15_000 });
  try {
    await probe.connect();
    await probe.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

async function bootstrapRoles(client: pg.Client, password: string, file: EnvFile) {
  const exists = (await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_ROLE])).rowCount === 1;
  // Setting the password again, even to the same value, makes the pooler reject the live site's
  // logins for a while (it caches the old verifier), so it is only set when the role is new or
  // the app's connection does not log in.
  if (!exists || !(await runtimeLoginWorks(file))) {
    await client.query(`${exists ? "ALTER" : "CREATE"} ROLE ${APP_ROLE} WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
    say(`runtime login role ${APP_ROLE}: ${exists ? "password set" : "created"}`);
  } else {
    say(`runtime login role ${APP_ROLE}: logs in already; password left as it is`);
  }
  const trgm = await client.query<{ schema: string }>("SELECT n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm'");
  if (trgm.rowCount === 0) await client.query("CREATE EXTENSION pg_trgm WITH SCHEMA extensions");
  else if (trgm.rows[0]!.schema !== "extensions") throw new Error(`pg_trgm is installed in schema ${trgm.rows[0]!.schema}; the migrations need it in "extensions"`);
  await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'beautybox_runtime') THEN CREATE ROLE beautybox_runtime NOLOGIN; END IF;
    END $$`);
  await client.query(`GRANT beautybox_runtime TO ${APP_ROLE}`);
  await client.query(`CREATE SCHEMA IF NOT EXISTS commerce AUTHORIZATION ${OWNER_ROLE}`);
  await client.query("REVOKE ALL ON SCHEMA commerce FROM PUBLIC");
  await client.query("GRANT USAGE ON SCHEMA commerce TO beautybox_runtime");
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER_ROLE} IN SCHEMA commerce GRANT SELECT, INSERT, UPDATE ON TABLES TO beautybox_runtime`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER_ROLE} IN SCHEMA commerce GRANT USAGE, SELECT ON SEQUENCES TO beautybox_runtime`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER_ROLE} IN SCHEMA commerce GRANT EXECUTE ON FUNCTIONS TO beautybox_runtime`);
  say("group role, commerce schema and default privileges: ready");
}

function migrate(ownerUrl: URL, file: EnvFile) {
  const url = new URL(ownerUrl.toString());
  url.searchParams.set("sslmode", "require");
  // Prisma's migration engine accepts any certificate unless told otherwise: with the CA it
  // checks the server against it (sslaccept=strict), as the pg client above does. The engine
  // reads certificate files only inside the project, so the copy goes under .local/ (ignored
  // by Git and Vercel) and is deleted afterwards.
  const ca = envValue(file, "DATABASE_SSL_CA");
  if (ca) fs.mkdirSync(path.resolve(".local"), { recursive: true });
  const caDir = ca ? fs.mkdtempSync(path.resolve(".local", "ca-")) : null;
  if (caDir) {
    const caPath = path.join(caDir, "supabase-ca.crt");
    fs.writeFileSync(caPath, `${ca!.replace(/\\n/g, "\n")}\n`, { mode: 0o600 });
    url.searchParams.set("sslcert", caPath);
    url.searchParams.set("sslaccept", "strict");
  }
  say(`applying migrations on ${url.hostname} as ${decodeURIComponent(url.username).split(".")[0]} (certificate ${caDir ? "verified" : "NOT verified: add DATABASE_SSL_CA"}) ...`);
  try {
    const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy"], {
      env: { ...process.env, MIGRATION_DATABASE_URL: url.toString() },
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    let output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    for (const secret of new Set([url.password, decodeURIComponent(url.password)].filter(Boolean))) output = output.replaceAll(secret, "***");
    const summary = output.split(/\r?\n/).filter((l) => /migration|applied|No pending|Error|error|P1\d{3}/i.test(l)).slice(-8);
    for (const line of summary) say(`  ${line.trim()}`);
    if (result.status !== 0) throw new Error("prisma migrate deploy failed (see the lines above)");
  } finally {
    if (caDir) fs.rmSync(caDir, { recursive: true, force: true });
  }
}

async function finishDatabase(client: pg.Client) {
  await client.query(`INSERT INTO commerce.deployment_profile (id, environment, demo_data_allowed, updated_at)
    VALUES (1, 'STAGING', true, now())
    ON CONFLICT (id) DO UPDATE SET environment = EXCLUDED.environment, demo_data_allowed = EXCLUDED.demo_data_allowed, updated_at = now()`);
  // Prisma's history table lives in "public", which Supabase's Data API exposes: no rows for it.
  await client.query("ALTER TABLE IF EXISTS public._prisma_migrations ENABLE ROW LEVEL SECURITY");
  const grants = await client.query<{ grantee: string }>("SELECT DISTINCT grantee FROM information_schema.role_table_grants WHERE table_schema = 'commerce' ORDER BY 1");
  const grantees = grants.rows.map((r) => r.grantee);
  say(`database profile STAGING recorded; commerce tables granted to: ${grantees.join(", ")}`);
  const unexpected = grantees.filter((g) => g !== OWNER_ROLE && g !== "beautybox_runtime");
  if (unexpected.length > 0) {
    for (const role of unexpected) await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA commerce FROM ${client.escapeIdentifier(role)}`);
    say(`revoked unexpected grants from: ${unexpected.join(", ")}`);
  }
}

async function scheduler(client: pg.Client, file: EnvFile) {
  const origin = envValue(file, "APP_ORIGIN");
  const secret = envValue(file, "WORKER_SECRET");
  if (!origin || !secret) throw new Error("APP_ORIGIN and WORKER_SECRET are needed for the scheduler");
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog"); // as Supabase documents it
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions");
  const existing = await client.query<{ id: string }>("SELECT id FROM vault.secrets WHERE name = $1", [VAULT_NAME]);
  if (existing.rowCount === 0) await client.query("SELECT vault.create_secret($1, $2)", [secret, VAULT_NAME]);
  else await client.query("SELECT vault.update_secret($1, $2)", [existing.rows[0]!.id, secret]);
  const url = `${origin.replace(/\/$/, "")}/api/v1/internal/jobs/run`;
  const command = `SELECT net.http_post(
      url := ${client.escapeLiteral(url)},
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ${client.escapeLiteral(VAULT_NAME)})),
      body := jsonb_build_object('batchSize', 20, 'maxRuntimeSeconds', 40),
      timeout_milliseconds := 55000
    )`;
  await client.query("SELECT cron.schedule($1, '* * * * *', $2)", [JOB_NAME, command]);
  await client.query("SELECT cron.schedule($1, '17 3 * * *', $2)", [CLEANUP_JOB, "DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'"]);
  say(`scheduler: ${JOB_NAME} calls ${url} every minute (secret kept in Vault); history older than 7 days is cleared daily`);
}

/** Settings staging shares with local development (same Supabase project, pawaPay sandbox). */
const SHARED = [
  "PAWAPAY_API_TOKEN",
  "PAWAPAY_SIGNING_PRIVATE_KEY",
  "PAWAPAY_SIGNING_KEY_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_PRIVATE_MEDIA_BUCKET",
  "SUPABASE_PUBLIC_MEDIA_BUCKET",
  "NEXT_PUBLIC_MEDIA_BASE_URL",
] as const;

function copyShared(file: EnvFile, source: EnvFile) {
  if (envValue(source, "PAWAPAY_API_TOKEN") && envValue(source, "PAWAPAY_MODE") !== "sandbox") {
    throw new Error(`${source.path} is not set to PAWAPAY_MODE=sandbox: staging takes only sandbox credentials`);
  }
  const copied: Record<string, string> = {};
  for (const name of SHARED) {
    const value = envValue(source, name);
    if (value && !envValue(file, name)) copied[name] = value;
  }
  if (Object.keys(copied).length > 0) setEnvValues(file, copied);
  say(Object.keys(copied).length > 0 ? `copied from ${source.path}: ${Object.keys(copied).join(", ")}` : `nothing to copy from ${source.path} (already filled in)`);
}

function storeCertificate(file: EnvFile, certificatePath: string) {
  const pem = fs.readFileSync(certificatePath, "utf8").trim();
  if (!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(pem)) {
    throw new Error("--ca-file must be the PEM certificate from Supabase > Database > Settings > SSL Configuration");
  }
  // One line with literal \n between lines: settings files hold one value per line.
  setEnvValues(file, { DATABASE_SSL: "verify", DATABASE_SSL_CA: pem.replace(/\r?\n/g, "\\n") });
  say("DATABASE_SSL_CA saved from the certificate file (DATABASE_SSL=verify)");
}

async function main() {
  const file = readEnvFile(arg("env-file") ?? ".env.staging.local");
  if (envValue(file, "APP_ENV") !== "staging") throw new Error("the settings file must say APP_ENV=staging");
  const copyFrom = arg("copy-from");
  if (copyFrom) copyShared(file, readEnvFile(copyFrom));
  const caFile = arg("ca-file");
  if (caFile) storeCertificate(file, caFile);
  const owner = envValue(file, "STAGING_OWNER_DATABASE_URL");
  if (!owner) throw new Error("add STAGING_OWNER_DATABASE_URL (Supabase session pooler, user postgres.<ref>, port 5432) to the settings file");
  const { url, ref } = poolerParts(owner);
  const supabaseUrl = envValue(file, "NEXT_PUBLIC_SUPABASE_URL");
  if (supabaseUrl && new URL(supabaseUrl).hostname.split(".")[0] !== ref) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and STAGING_OWNER_DATABASE_URL point at different Supabase projects");
  }

  generateMissing(file);
  const password = envValue(file, "STAGING_RUNTIME_DB_PASSWORD")!;
  // The app's own connection: the runtime role (created below with this password) through the
  // transaction pooler. Known before any database work, so --prepare can write it too.
  const runtime = new URL(url.toString());
  runtime.username = `${APP_ROLE}.${ref}`;
  runtime.password = password;
  runtime.port = "6543";
  runtime.search = "";
  if (envValue(file, "DATABASE_URL") !== runtime.toString()) {
    setEnvValues(file, { DATABASE_URL: runtime.toString(), DATABASE_POOL_MAX: envValue(file, "DATABASE_POOL_MAX") ?? "3" });
    say("DATABASE_URL (runtime role, transaction pooler) saved");
  }

  if (process.argv.includes("--prepare")) {
    const still = [
      ...(url.password ? [] : ["the database password (asked at a hidden prompt when you run the set-up without --prepare)"]),
      ...(envValue(file, "DATABASE_SSL_CA") ? [] : ["DATABASE_SSL_CA (add with --ca-file <downloaded certificate>)"]),
      ...(envValue(file, "SITE_GATE") === "on" && !envValue(file, "SITE_ACCESS_CODE_HASH") ? ["SITE_ACCESS_CODE_HASH (npm run staging:access-code)"] : []),
      ...["PAWAPAY_API_TOKEN", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"].filter((n) => !envValue(file, n)),
    ];
    say(still.length > 0 ? `settings prepared; still needed:\n  - ${still.join("\n  - ")}` : "settings prepared; nothing else needed before the database step");
    return;
  }

  if (!url.password) {
    // Typed at a hidden prompt and kept only in this settings file (limited to this Windows user).
    const typed = await promptHidden("Supabase database password (typing is hidden): ");
    if (!typed) throw new Error("no password typed");
    url.password = typed; // the URL setter percent-encodes it
    setEnvValues(file, { STAGING_OWNER_DATABASE_URL: url.toString() });
    say("database password saved in the settings file");
  }

  const client = new pg.Client({ connectionString: url.toString(), ssl: tls(file) });
  await client.connect();
  say(`connected to the staging database (project ${ref}) over TLS${envValue(file, "DATABASE_SSL_CA") ? " with certificate verification" : " (certificate not verified: add DATABASE_SSL_CA)"}`);
  try {
    await bootstrapRoles(client, password, file);
    migrate(url, file);
    await finishDatabase(client);
    if (process.argv.includes("--scheduler")) await scheduler(client, file);
  } finally {
    await client.end();
  }

  if (process.argv.includes("--seed")) {
    const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "--conditions=react-server", `--env-file=${file.path}`, path.join("scripts", "seed-staging.ts")], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) throw new Error("the staging seed failed (see above)");
  }
  say("done");
}

main().catch((error) => {
  console.error("[staging] failed:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
