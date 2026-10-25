import fs from "node:fs";
import path from "node:path";

// Integration tests run against the real local PostgreSQL TEST database prepared by
// `npm run setup:local`. Never point them at a shared or production database.
const file = path.resolve(import.meta.dirname, "..", "..", ".env.test");
if (!fs.existsSync(file)) throw new Error("Missing .env.test - run `npm run setup:local` first");
for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i)] = line.slice(i + 1);
}
if (process.env.APP_ENV !== "test" || !/beautybox_test/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Integration tests require APP_ENV=test and the beautybox_test database");
}
