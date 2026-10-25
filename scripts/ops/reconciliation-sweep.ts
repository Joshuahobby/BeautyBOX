// Reconciliation sweep (I13): read-only integrity report across money, stock and jobs.
//
//   npm run ops:sweep -- --env-file <path>
//
// Prints each check with its count and up to five record ids (no personal data) and exits
// 1 when any issue is found, so it can run on a schedule and alert. Hosted environments
// can call GET /api/v1/internal/reconciliation with the worker secret instead.
import { db } from "@/server/db";
import { reconciliationSweep } from "@/modules/ops/reconciliation";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const envFile = arg("env-file");
  if (!envFile) {
    console.error("usage: npm run ops:sweep -- --env-file <path>");
    process.exit(1);
  }
  process.loadEnvFile(envFile);
  const report = await reconciliationSweep();
  for (const c of report.checks) {
    console.log(`${c.count === 0 ? "ok  " : "FAIL"} ${c.code.padEnd(32)} ${String(c.count).padStart(5)}  ${c.count ? c.sample.join(", ") : ""}`);
  }
  console.log(`[sweep] ${report.issues} issue(s) at ${report.generatedAt} (APP_ENV=${process.env.APP_ENV})`);
  return report.issues;
}

main()
  .then(async (issues) => {
    await db().$disconnect();
    process.exit(issues > 0 ? 1 : 0);
  })
  .catch(async (error) => {
    console.error("[sweep] failed:", error instanceof Error ? error.message : error);
    await db().$disconnect();
    process.exit(2);
  });
