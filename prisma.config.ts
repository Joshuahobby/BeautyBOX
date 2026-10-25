import { defineConfig } from "prisma/config";

// Prisma CLI configuration. Migrations run with the schema-owner connection
// (MIGRATION_DATABASE_URL); the application runtime uses the narrowly privileged
// DATABASE_URL through the pg driver adapter (src/server/db.ts). Node's built-in
// env-file loader is used instead of an extra dotenv dependency.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // file absent: rely on the process environment
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.MIGRATION_DATABASE_URL ?? "",
  },
});
