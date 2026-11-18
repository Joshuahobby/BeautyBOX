#!/usr/bin/env node
// Project-local PostgreSQL cluster for development and integration tests.
//
// Uses existing PostgreSQL server binaries (PG_BIN or a detected install) but keeps
// its own data directory under .local/postgres and its own port. It never touches a
// system service, another cluster's data directory, or any non-BeautyBOX database.
//
// Commands: init | start | stop | status | setup | reset-db <name> | env | psql
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writePrivateFile } from "../lib/private-file.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const stateDir = path.join(root, ".local", "postgres");
const dataDir = path.join(stateDir, "data");
const credFile = path.join(stateDir, "credentials.json");
const logFile = path.join(stateDir, "server.log");
const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const host = "127.0.0.1";
const DATABASES = ["beautybox_dev", "beautybox_test"];

function findBin() {
  const candidates = [
    process.env.PG_BIN,
    "C:\\Program Files\\PostgreSQL\\17\\bin",
    "C:\\Program Files\\PostgreSQL\\16\\bin",
    "/usr/lib/postgresql/17/bin",
    "/usr/lib/postgresql/16/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
  ].filter(Boolean);
  const exe = process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl";
  for (const dir of candidates) if (fs.existsSync(path.join(dir, exe))) return dir;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["pg_ctl"], { encoding: "utf8" });
  if (which.status === 0) return path.dirname(which.stdout.split(/\r?\n/)[0].trim());
  fail("PostgreSQL server binaries not found. Set PG_BIN to a directory containing pg_ctl/initdb/psql (PostgreSQL 15+).");
}

const bin = (name) => path.join(findBin(), process.platform === "win32" ? `${name}.exe` : name);

function fail(message) {
  console.error(`[local-postgres] ${message}`);
  process.exit(1);
}

function run(name, args, { env, input, allowFail } = {}) {
  const result = spawnSync(bin(name), args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    input,
  });
  if (result.status !== 0 && !allowFail) {
    fail(`${name} ${args.join(" ")} failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result;
}

function readCreds() {
  if (!fs.existsSync(credFile)) fail("Cluster not initialised. Run: npm run db:local -- init");
  return JSON.parse(fs.readFileSync(credFile, "utf8"));
}

function isRunning() {
  if (!fs.existsSync(dataDir)) return false;
  return run("pg_ctl", ["status", "-D", dataDir], { allowFail: true }).status === 0;
}

function superPsql(sql, db = "postgres") {
  const creds = readCreds();
  return run("psql", ["-v", "ON_ERROR_STOP=1", "-q", "-h", host, "-p", String(port), "-U", creds.superuser.user, "-d", db], {
    env: { PGPASSWORD: creds.superuser.password },
    input: sql,
  });
}

const secret = () => randomBytes(24).toString("base64url");

function init() {
  if (fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
    console.log(`[local-postgres] already initialised at ${dataDir}`);
    return;
  }
  fs.mkdirSync(stateDir, { recursive: true });
  const creds = {
    superuser: { user: "bb_local_super", password: secret() },
    owner: { user: "bb_owner", password: secret() },
    app: { user: "bb_app", password: secret() },
  };
  const pwFile = path.join(stateDir, "pwfile.tmp");
  writePrivateFile(pwFile, creds.superuser.password);
  try {
    run("initdb", [
      "-D", dataDir,
      "-U", creds.superuser.user,
      `--pwfile=${pwFile}`,
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C",
    ]);
  } finally {
    fs.rmSync(pwFile, { force: true });
  }
  writePrivateFile(credFile, JSON.stringify(creds, null, 2));
  console.log(`[local-postgres] initialised cluster in ${dataDir}`);
}

function start() {
  if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) init();
  if (isRunning()) {
    console.log(`[local-postgres] already running on ${host}:${port}`);
    return;
  }
  // Durability is relaxed on purpose: this cluster holds only synthetic data that
  // `npm run setup:local -- --reset` regenerates, and per-test table resets were
  // dominated by disk syncs. Never use these settings for staging or production.
  const durability = process.env.LOCAL_PG_DURABLE === "1" ? "-c fsync=on" : "-c fsync=off -c synchronous_commit=off -c full_page_writes=off";
  // All project clients use loopback TCP. Do not depend on permission to a system
  // Unix-socket directory (for example /var/run/postgresql on GitHub's runners).
  const opts = `-p ${port} -c listen_addresses=${host} -c unix_socket_directories= -c shared_buffers=32MB -c max_connections=80 ${durability} -c timezone=UTC`;
  // stdio must not be piped: on Windows the server inherits the pipe handles and
  // spawnSync would wait for them to close (i.e. until the server stops).
  const started = spawnSync(bin("pg_ctl"), ["start", "-D", dataDir, "-l", logFile, "-w", "-t", "60", "-o", opts], {
    stdio: "ignore",
    windowsHide: true,
  });
  if (started.status !== 0 || !isRunning()) fail(`pg_ctl start failed; see ${logFile}`);
  console.log(`[local-postgres] running on ${host}:${port}`);
}

function stop() {
  if (!isRunning()) {
    console.log("[local-postgres] not running");
    return;
  }
  run("pg_ctl", ["stop", "-D", dataDir, "-m", "fast", "-w"]);
  console.log("[local-postgres] stopped");
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Roles mirror the production intent: bb_owner owns the schema and runs migrations;
// bb_app is the narrowly privileged runtime role (DML only, granted by migrations).
function setup() {
  start();
  const { owner, app } = readCreds();
  superPsql(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${owner.user}') THEN
    CREATE ROLE ${owner.user} LOGIN PASSWORD ${quoteLiteral(owner.password)};
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${app.user}') THEN
    CREATE ROLE ${app.user} LOGIN PASSWORD ${quoteLiteral(app.password)};
  END IF;
END $$;
`);
  for (const db of DATABASES) createDatabase(db);
  console.log(`[local-postgres] roles and databases ready: ${DATABASES.join(", ")}`);
}

function createDatabase(db) {
  const { superuser, owner, app } = readCreds();
  const check = run("psql", ["-tA", "-h", host, "-p", String(port), "-U", superuser.user, "-d", "postgres", "-c", `SELECT 1 FROM pg_database WHERE datname='${db}'`], {
    env: { PGPASSWORD: superuser.password },
  });
  if (check.stdout.trim() !== "1") superPsql(`CREATE DATABASE ${db} OWNER ${owner.user} ENCODING 'UTF8' TEMPLATE template0;`);
  superPsql(
    `REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${app.user};
GRANT CONNECT, CREATE ON DATABASE ${db} TO ${owner.user};
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO ${owner.user};`,
    db,
  );
}

function resetDb(db) {
  if (!DATABASES.includes(db)) fail(`reset-db only accepts: ${DATABASES.join(", ")}`);
  start();
  superPsql(`DROP DATABASE IF EXISTS ${db} WITH (FORCE);`);
  createDatabase(db);
  console.log(`[local-postgres] recreated ${db}`);
}

function urls() {
  const { owner, app } = readCreds();
  const make = (u, db) => `postgresql://${u.user}:${encodeURIComponent(u.password)}@${host}:${port}/${db}`;
  return {
    DATABASE_URL: make(app, "beautybox_dev"),
    MIGRATION_DATABASE_URL: make(owner, "beautybox_dev"),
    TEST_DATABASE_URL: make(app, "beautybox_test"),
    TEST_MIGRATION_DATABASE_URL: make(owner, "beautybox_test"),
  };
}

// Run a SQL file as the local cluster superuser with psql variables (key=value).
function runSqlFile(db, file, vars) {
  if (!DATABASES.includes(db)) fail(`run-sql only accepts: ${DATABASES.join(", ")}`);
  start();
  const { superuser } = readCreds();
  const args = ["-v", "ON_ERROR_STOP=1", "-q", "-h", host, "-p", String(port), "-U", superuser.user, "-d", db, "-f", file];
  for (const v of vars) args.unshift("-v", v);
  run("psql", args, { env: { PGPASSWORD: superuser.password } });
}

const [command, arg, ...rest] = process.argv.slice(2);
switch (command) {
  case "run-sql": runSqlFile(arg, rest[0], rest.slice(1)); break;
  case "init": init(); break;
  case "start": start(); break;
  case "stop": stop(); break;
  case "status": console.log(isRunning() ? `running on ${host}:${port}` : "not running"); break;
  case "setup": setup(); break;
  case "reset-db": resetDb(arg); break;
  case "env": for (const [k, v] of Object.entries(urls())) console.log(`${k}=${v}`); break;
  default:
    console.log("usage: local-postgres.mjs init|start|stop|status|setup|reset-db <db>|env");
    process.exit(command ? 1 : 0);
}
