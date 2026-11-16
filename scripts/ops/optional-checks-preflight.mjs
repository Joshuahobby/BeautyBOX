// Presence/readiness only: no provider requests, database writes or credential output.
import fs from "node:fs";
const fileValues = {};
if (fs.existsSync(".env.local"))
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0 && !line.startsWith("#"))
      fileValues[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
// Existing opt-in suites read .env.local explicitly; runtime secrets alone do not run them.
const has = (name) => Boolean(fileValues[name]);
const storage = has("NEXT_PUBLIC_SUPABASE_URL") && has("SUPABASE_SECRET_KEY");
const sandbox =
  has("PAWAPAY_API_TOKEN") &&
  fileValues.PAWAPAY_MODE === "sandbox" &&
  !has("PAWAPAY_BASE_URL");
const runtimeHas = (name) => Boolean(process.env[name] || fileValues[name]);
const report = {
  checkedAt: new Date().toISOString(),
  providerRequests: 0,
  settingsChanged: false,
  optionalSuites: [
    {
      suite: "storage-supabase.test.ts",
      cases: 2,
      status: storage ? "READY_TO_OPT_IN" : "MISSING_CREDENTIALS",
      required: {
        NEXT_PUBLIC_SUPABASE_URL: has("NEXT_PUBLIC_SUPABASE_URL"),
        SUPABASE_SECRET_KEY: has("SUPABASE_SECRET_KEY"),
      },
      command:
        "RUN_SUPABASE_STORAGE_TESTS=1 npx vitest run --project integration tests/integration/storage-supabase.test.ts",
    },
    {
      suite: "pawapay-sandbox.test.ts",
      cases: 4,
      status: sandbox ? "READY_TO_OPT_IN" : "MISSING_SANDBOX_CONFIGURATION",
      required: {
        PAWAPAY_API_TOKEN: has("PAWAPAY_API_TOKEN"),
        sandboxMode: fileValues.PAWAPAY_MODE === "sandbox",
        customEndpointAbsent: !has("PAWAPAY_BASE_URL"),
      },
      command:
        "RUN_PAWAPAY_SANDBOX_TESTS=1 npx vitest run --project integration tests/integration/pawapay-sandbox.test.ts",
    },
  ],
  google: {
    serverKeyPresent: runtimeHas("GOOGLE_ROUTES_API_KEY"),
    separateBrowserEmbedKeyPresent: runtimeHas(
      "NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY",
    ),
    liveCoverage: "PENDING_BILLING_AND_EXPLICIT_LIVE_CHECK",
    command: "npm run delivery:check-google",
  },
  sms: {
    realProvider: "NOT_IMPLEMENTED_OR_CONFIGURED",
    localSimulation: "AVAILABLE",
    realMessagesSent: 0,
  },
  backupRestore: {
    scope: "LOCAL_TEST_ONLY",
    command: "npm run ops:drill -- --source beautybox_test",
    hostedRestore: "REQUIRES_SEPARATE_HOSTED_REHEARSAL",
  },
  note: "READY_TO_OPT_IN is not a passed test. Review the isolated target before opting in. Put credentials in private environment settings, never chat or Git.",
};
console.log(JSON.stringify(report, null, 2));
