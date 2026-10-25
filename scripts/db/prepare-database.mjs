#!/usr/bin/env node
// Prepare one LOCAL/TEST database: role bootstrap, migrations, simulated provider
// schema, deployment profile, and (dev only) demo fixtures.
//   node scripts/db/prepare-database.mjs <env-file> <database> <LOCAL|TEST>
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const [envFile, database, profile] = process.argv.slice(2);
if (!envFile || !database || !["LOCAL", "TEST"].includes(profile ?? "")) {
  console.error("usage: prepare-database.mjs <env-file> <database> <LOCAL|TEST>");
  process.exit(1);
}

const env = { ...process.env };
for (const line of fs.readFileSync(path.join(root, envFile), "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i)] = line.slice(i + 1);
}
if (env.APP_ENV === "production" || env.APP_ENV === "staging") {
  console.error("prepare-database is for local/test databases only");
  process.exit(1);
}

const pg = path.join(root, "scripts", "db", "local-postgres.mjs");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...env, ...extraEnv }, shell: process.platform === "win32" && cmd.endsWith(".cmd") });
  if (r.status !== 0) {
    console.error(`[prepare] failed: ${path.basename(cmd)} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

console.log(`[prepare] ${database}: bootstrap roles`);
run(process.execPath, [pg, "run-sql", database, path.join(root, "scripts", "db", "bootstrap-roles.sql"), "owner_role=bb_owner", "app_role=bb_app"]);

console.log(`[prepare] ${database}: migrate`);
run(npx, ["prisma", "migrate", "deploy"]);

console.log(`[prepare] ${database}: simulated provider schema + deployment profile`);
const extra = path.join(root, ".local", `prepare-${database}.sql`);
fs.mkdirSync(path.dirname(extra), { recursive: true });
fs.writeFileSync(
  extra,
  `${fs.readFileSync(path.join(root, "scripts", "db", "devsim.sql"), "utf8")}
ALTER SCHEMA devsim OWNER TO bb_owner;
ALTER TABLE devsim.deposits OWNER TO bb_owner;
ALTER TABLE devsim.refunds OWNER TO bb_owner;
ALTER TABLE devsim.settings OWNER TO bb_owner;
ALTER TABLE devsim.sms_messages OWNER TO bb_owner;
GRANT USAGE ON SCHEMA devsim TO beautybox_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA devsim TO beautybox_runtime;
INSERT INTO commerce.deployment_profile (id, environment, demo_data_allowed, updated_at)
VALUES (1, '${profile}', true, now())
ON CONFLICT (id) DO UPDATE SET environment = EXCLUDED.environment, demo_data_allowed = EXCLUDED.demo_data_allowed, updated_at = now();
`,
);
run(process.execPath, [pg, "run-sql", database, extra]);

if (profile === "LOCAL") {
  console.log(`[prepare] ${database}: demo fixtures`);
  run(npx, ["tsx", "--conditions=react-server", "scripts/seed-demo.ts"]);
}
console.log(`[prepare] ${database}: ready`);
