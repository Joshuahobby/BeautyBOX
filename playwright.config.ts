import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Browser tests drive the real application against the TEST database with the fake
// payment/routing adapters. They never touch the dev database or any external service.
const testEnv: Record<string, string> = {};
const envFile = path.resolve(import.meta.dirname, ".env.test");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("#"))
      testEnv[line.slice(0, i)] = line.slice(i + 1);
  }
}

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // A production build: realistic, no on-demand compilation, and it doubles as the clean-build check.
    command: "npx next build && npx next start --port 3100",
    // Readiness probe on a page that needs no shop data: the database is seeded only after
    // the server is up (global setup), so a previously failed seed must not block startup.
    url: "http://localhost:3100/staff/sign-in",
    timeout: 900_000,
    reuseExistingServer: false,
    env: {
      ...testEnv,
      GOOGLE_ROUTES_API_KEY: "",
      GOOGLE_PLACES_API_KEY: "",
      GOOGLE_TWO_WHEELER_COVERAGE_APPROVED: "false",
      NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY: "test-browser-key",
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
