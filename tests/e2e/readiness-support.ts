import fs from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
export const testEnv: Record<string, string> = Object.fromEntries(
  fs
    .readFileSync(new URL("../../.env.test", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [
      line.slice(0, line.indexOf("=")),
      line.slice(line.indexOf("=") + 1),
    ]),
);
const target = new URL(testEnv.MIGRATION_DATABASE_URL!);
if (
  testEnv.APP_ENV !== "test" ||
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  target.pathname !== "/beautybox_test"
)
  throw new Error(
    "Readiness helpers require the isolated local TEST database.",
  );
export async function ownerQuery(sql: string, values: unknown[] = []) {
  const client = new pg.Client({
    connectionString: testEnv.MIGRATION_DATABASE_URL,
  });
  await client.connect();
  try {
    return await client.query(sql, values);
  } finally {
    await client.end();
  }
}
export async function staffMember(
  role: "OPERATIONS" | "SUPPORT" | "FINANCE" | "ADMIN",
) {
  const id = randomUUID();
  await ownerQuery(
    "INSERT INTO commerce.staff_members (auth_user_id, email, display_name, role) VALUES ($1, $2, $3, $4)",
    [id, `${id}@example.test`, `Readiness ${role}`, role],
  );
  return `${id}:aal2`;
}
