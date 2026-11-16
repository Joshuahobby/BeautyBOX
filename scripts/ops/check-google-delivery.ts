import fs from "node:fs";
import { checkGoogleDelivery } from "@/modules/delivery/google-check";

async function main() {
  const args = process.argv.slice(2);
  const config = args
    .find((a) => a.startsWith("--config-file="))
    ?.split("=")[1];
  if (config) {
    if (![".env.local", ".env.test"].includes(config))
      throw new Error("Local/test files only.");
    process.loadEnvFile(config);
  }
  const ready = {
    routesKeyPresent: Boolean(process.env.GOOGLE_ROUTES_API_KEY),
    placesKeyPresent: Boolean(
      process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_ROUTES_API_KEY,
    ),
    embedKeyPresent: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY),
    coverageApproved:
      process.env.GOOGLE_TWO_WHEELER_COVERAGE_APPROVED === "true",
  };
  if (!args.includes("--live")) {
    console.log(
      JSON.stringify({
        mode: "preflight only",
        ...ready,
        requests: 0,
        settingsChanged: false,
      }),
    );
    return;
  }
  if (
    !args.includes("--billing-active") ||
    !ready.routesKeyPresent ||
    !ready.placesKeyPresent
  )
    throw new Error(
      "Restore billing and both API permissions before an explicit live check.",
    );
  const requested =
    args.find((a) => a.startsWith("--cases="))?.split("=")[1] ?? "12";
  const result = await checkGoogleDelivery({
    routesKey: process.env.GOOGLE_ROUTES_API_KEY!,
    placesKey: process.env.GOOGLE_PLACES_API_KEY,
    caseCount: Number(requested),
  });
  const text = JSON.stringify(result, null, 2) + "\n";
  const output = args
    .find((a) => a.startsWith("--output="))
    ?.slice("--output=".length);
  if (output) fs.writeFileSync(output, text, { mode: 0o600 });
  console.log(text);
  if (
    result.stoppedOnFailure ||
    result.cases.some((c) => c.outcome !== "ROUTED")
  )
    process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "Google check did not complete. Check local configuration, billing status and the explicit request budget. No settings were changed.",
  );
  process.exitCode = 1;
});
