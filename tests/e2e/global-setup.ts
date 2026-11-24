import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

// Fresh synthetic shop for every browser run: wipe the TEST database and load the demo
// catalog. Refuses anything that is not the local beautybox_test database.
export default async function globalSetup() {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(root, ".env.test"), "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("#")) env[line.slice(0, i)] = line.slice(i + 1);
  }
  if (env.APP_ENV !== "test" || !/beautybox_test/.test(env.MIGRATION_DATABASE_URL ?? "")) {
    throw new Error("E2E setup only runs against the local beautybox_test database");
  }
  const client = new pg.Client({ connectionString: env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'commerce' AND tablename NOT IN ('deployment_profile', '_prisma_migrations')`,
    );
    await client.query(`TRUNCATE ${rows.map((r: { tablename: string }) => `commerce."${r.tablename}"`).join(", ")}, devsim.refunds, devsim.deposits, devsim.sms_messages, devsim.email_messages RESTART IDENTITY CASCADE`);
    await client.query(`UPDATE devsim.settings SET enabled_methods = ARRAY['MTN_MOMO_RWA', 'AIRTEL_RWA']`);
    await client.query(`UPDATE commerce.deployment_profile SET environment = 'TEST', demo_data_allowed = true`);
  } finally {
    await client.end();
  }
  fs.rmSync(path.join(root, ".local", "media", "test"), { recursive: true, force: true });
  const seeded = spawnSync(process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "--conditions=react-server", "scripts/seed-demo.ts"], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (seeded.status !== 0) throw new Error("demo seed failed");
}
