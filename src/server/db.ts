import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { serverEnv } from "./env";

// The application server is the only commerce database client (handoff Architecture).
// Runtime uses the narrowly privileged role in DATABASE_URL; migrations use a separate
// owner connection configured only in prisma.config.ts.

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

const globalForDb = globalThis as unknown as { beautyboxPrisma?: PrismaClient };

export type DbTls = { mode: "off" | "require" | "verify"; ca?: string };

/** node-postgres TLS options: "verify" checks the certificate chain and host name against the CA. */
export function tlsOptions(tls: DbTls): false | { rejectUnauthorized: boolean; ca?: string } {
  if (tls.mode === "off") return false;
  if (tls.mode === "require") return { rejectUnauthorized: false };
  return { rejectUnauthorized: true, ca: tls.ca?.replace(/\\n/g, "\n") };
}

export function createPrismaClient(connectionString: string, poolMax: number, tls: DbTls = { mode: "off" }): PrismaClient {
  // On serverless hosting a suspended instance cannot run idle timers, so connections are
  // released quickly while it is still awake (the transaction pooler keeps the server side warm).
  const idleTimeoutMillis = process.env.VERCEL ? 5_000 : 10_000;
  const adapter = new PrismaPg({ connectionString, max: poolMax, idleTimeoutMillis, ssl: tlsOptions(tls) });
  return new PrismaClient({ adapter });
}

export function db(): PrismaClient {
  if (!globalForDb.beautyboxPrisma) {
    const env = serverEnv();
    globalForDb.beautyboxPrisma = createPrismaClient(env.DATABASE_URL, env.DATABASE_POOL_MAX, { mode: env.DATABASE_SSL, ca: env.DATABASE_SSL_CA });
  }
  return globalForDb.beautyboxPrisma;
}

/** Test hook: use an explicit client (e.g. the test database). */
export function setDbForTests(client: PrismaClient | undefined) {
  globalForDb.beautyboxPrisma = client;
}

const RETRYABLE_SQLSTATE = new Set(["40001", "40P01"]); // serialization failure, deadlock

function isRetryable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") return true; // write conflict / deadlock, retry the transaction
    const sqlState = (error.meta as { code?: string } | undefined)?.code;
    if (sqlState && RETRYABLE_SQLSTATE.has(sqlState)) return true;
  }
  const text = error instanceof Error ? error.message : "";
  return /40001|40P01|could not serialize|deadlock detected/i.test(text);
}

/**
 * Short interactive transaction with bounded retries for serialization failures and
 * deadlocks. Never perform HTTP calls inside `fn`: locks must not wait on providers.
 */
export async function transaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options: { isolationLevel?: Prisma.TransactionIsolationLevel; attempts?: number; timeoutMs?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await db().$transaction(fn, {
        isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: options.timeoutMs ?? 15_000,
      });
    } catch (error) {
      if (attempt >= attempts || !isRetryable(error)) throw error;
      await new Promise((r) => setTimeout(r, 10 * 2 ** attempt + Math.floor(Math.random() * 25)));
    }
  }
}

export function isUniqueViolation(error: unknown, target?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  if (!target) return true;
  return JSON.stringify(error.meta ?? {}).includes(target);
}
