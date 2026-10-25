// Local job worker loop (development stand-in for Supabase Cron hitting
// POST /api/v1/internal/jobs/run). Runs bounded batches every two seconds.
//   npm run worker
import { runDueJobs } from "@/modules/jobs/worker";
import { db } from "@/server/db";
import { serverEnv } from "@/server/env";

if (serverEnv().APP_ENV === "production") {
  console.error("Use the authenticated scheduler endpoint in production, not this loop.");
  process.exit(1);
}

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function loop() {
  console.log("[worker] polling due jobs every 2s (Ctrl+C to stop)");
  while (!stopping) {
    try {
      const result = await runDueJobs({ batchSize: 20, maxRuntimeMs: 15_000 });
      if (result.claimed > 0) console.log(`[worker] ${JSON.stringify(result)}`);
    } catch (error) {
      console.error("[worker] batch failed:", error instanceof Error ? error.name : "unknown");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await db().$disconnect();
}

void loop();
