#!/usr/bin/env node
// T20 backup and restore drill against the PROJECT-LOCAL PostgreSQL cluster only.
//
// 1. pg_dump (custom format) of a BeautyBOX database, with a SHA-256 of the file.
// 2. Copy of the local product-media folder (database backups never include media).
// 3. pg_restore into a scratch database `beautybox_restore_drill` in the same cluster.
// 4. Compare source and restore: row counts per table, migrations, constraints/indexes/
//    triggers, pending durable jobs, inventory ledger reconciliation, and
//    `prisma migrate status` (schema compatible with this application build).
// 5. Report timings, then drop the scratch database (unless --keep).
//
// Usage: node scripts/ops/backup-restore-drill.mjs [--source beautybox_dev|beautybox_test] [--keep]
// It never touches a system PostgreSQL service or any database outside this cluster.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const creds = JSON.parse(fs.readFileSync(path.join(root, ".local", "postgres", "credentials.json"), "utf8"));
const host = "127.0.0.1";
const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const args = process.argv.slice(2);
const source = args.includes("--source") ? args[args.indexOf("--source") + 1] : "beautybox_dev";
const keep = args.includes("--keep");
const TARGET = "beautybox_restore_drill";
if (!["beautybox_dev", "beautybox_test"].includes(source)) throw new Error("--source must be beautybox_dev or beautybox_test");

function binDir() {
  for (const dir of [process.env.PG_BIN, "C:\\Program Files\\PostgreSQL\\17\\bin", "C:\\Program Files\\PostgreSQL\\16\\bin", "/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin", "/opt/homebrew/opt/postgresql@16/bin"].filter(Boolean)) {
    if (fs.existsSync(path.join(dir, process.platform === "win32" ? "pg_dump.exe" : "pg_dump"))) return dir;
  }
  throw new Error("pg_dump not found; set PG_BIN");
}
const bin = (name) => path.join(binDir(), process.platform === "win32" ? `${name}.exe` : name);
const superEnv = { ...process.env, PGPASSWORD: creds.superuser.password };

function run(name, argv, opts = {}) {
  const r = spawnSync(bin(name), argv, { encoding: "utf8", env: superEnv, maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${name} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

const conn = (db) => ["-h", host, "-p", String(port), "-U", creds.superuser.user, "-d", db];
const sql = (db, query) => run("psql", [...conn(db), "-tA", "-v", "ON_ERROR_STOP=1", "-c", query]).trim();
const timed = (fn) => {
  const t = process.hrtime.bigint();
  const value = fn();
  return { value, seconds: Number(process.hrtime.bigint() - t) / 1e9 };
};

function snapshot(db) {
  const tables = sql(db, `SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname IN ('commerce','devsim') ORDER BY 1`)
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  const counts = Object.fromEntries(tables.map((t) => {
    if (!/^[a-z_]+\.[a-z_]+$/.test(t)) throw new Error(`unexpected table name ${t}`);
    return [t, Number(sql(db, `SELECT count(*) FROM ${t}`))];
  }));
  return {
    counts,
    migrations: sql(db, `SELECT string_agg(migration_name || ':' || checksum, ',' ORDER BY migration_name) FROM public._prisma_migrations WHERE finished_at IS NOT NULL`),
    constraints: Number(sql(db, `SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'commerce'`)),
    indexes: Number(sql(db, `SELECT count(*) FROM pg_indexes WHERE schemaname = 'commerce'`)),
    triggers: Number(sql(db, `SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'commerce' AND NOT t.tgisinternal`)),
    pendingJobs: sql(db, `SELECT coalesce(string_agg(state || '=' || n, ',' ORDER BY state), '') FROM (SELECT state, count(*) n FROM commerce.outbox_jobs WHERE state <> 'SUCCEEDED' GROUP BY state) s`),
    ledgerMismatches: Number(
      sql(
        db,
        `SELECT count(*) FROM commerce.inventory_lots l LEFT JOIN (SELECT lot_id, sum(on_hand_delta) oh, sum(reserved_delta) rs, sum(committed_delta) cm FROM commerce.inventory_movements GROUP BY lot_id) m ON m.lot_id = l.id
          WHERE l.quantity_on_hand <> coalesce(m.oh,0) OR l.reserved_qty <> coalesce(m.rs,0) OR l.committed_qty <> coalesce(m.cm,0)`,
      ),
    ),
    runtimeGrants: Number(sql(db, `SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'beautybox_runtime' AND table_schema = 'commerce'`)),
  };
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath ?? e.path, e.name)));
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(root, ".local", "backups", `${source}-${stamp}`);
fs.mkdirSync(backupDir, { recursive: true });
const dumpFile = path.join(backupDir, "database.dump");

console.log(`[drill] source ${source} → backup ${path.relative(root, backupDir)}`);
const before = snapshot(source);
const backup = timed(() => run("pg_dump", [...conn(source), "-Fc", "--no-password", "-f", dumpFile]));
const sha256 = createHash("sha256").update(fs.readFileSync(dumpFile)).digest("hex");

const mediaEnv = source === "beautybox_test" ? "test" : "local";
const mediaSource = path.join(root, ".local", "media", mediaEnv);
const media = timed(() => {
  if (fs.existsSync(mediaSource)) fs.cpSync(mediaSource, path.join(backupDir, "media"), { recursive: true });
  return listFiles(path.join(backupDir, "media")).length;
});

sql("postgres", `DROP DATABASE IF EXISTS ${TARGET} WITH (FORCE)`);
sql("postgres", `CREATE DATABASE ${TARGET} OWNER ${creds.owner.user} ENCODING 'UTF8' TEMPLATE template0`);
const restore = timed(() => run("pg_restore", [...conn(TARGET), "--exit-on-error", "--no-password", dumpFile]));
const after = snapshot(TARGET);

const ownerUrl = `postgresql://${creds.owner.user}:${encodeURIComponent(creds.owner.password)}@${host}:${port}/${TARGET}`;
const status = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "status"], {
  cwd: root,
  encoding: "utf8",
  shell: process.platform === "win32",
  env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
});
const schemaUpToDate = status.status === 0 && /up to date/i.test(status.stdout);

const tableDiffs = Object.keys({ ...before.counts, ...after.counts }).filter((t) => before.counts[t] !== after.counts[t]);
const checks = {
  rowCountsMatch: tableDiffs.length === 0,
  migrationsMatch: before.migrations === after.migrations && after.migrations.length > 0,
  constraintsMatch: before.constraints === after.constraints,
  indexesMatch: before.indexes === after.indexes,
  triggersMatch: before.triggers === after.triggers && after.triggers > 0,
  pendingJobsRetained: before.pendingJobs === after.pendingJobs,
  ledgerReconciles: after.ledgerMismatches === 0,
  runtimeGrantsRestored: before.runtimeGrants === after.runtimeGrants && after.runtimeGrants > 0,
  schemaCompatibleWithBuild: schemaUpToDate,
  mediaCopied: media.value === listFiles(mediaSource).length,
};
const report = {
  drillAt: new Date().toISOString(),
  source,
  dumpBytes: fs.statSync(dumpFile).size,
  dumpSha256: sha256,
  backupSeconds: Number(backup.seconds.toFixed(2)),
  mediaFiles: media.value,
  restoreSeconds: Number(restore.seconds.toFixed(2)),
  tables: Object.keys(after.counts).length,
  rows: Object.values(after.counts).reduce((a, b) => a + b, 0),
  pendingJobs: after.pendingJobs || "none",
  tableDiffs,
  checks,
  passed: Object.values(checks).every(Boolean),
};
fs.writeFileSync(path.join(backupDir, "drill-report.json"), JSON.stringify(report, null, 2));
if (!keep) sql("postgres", `DROP DATABASE IF EXISTS ${TARGET} WITH (FORCE)`);
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
