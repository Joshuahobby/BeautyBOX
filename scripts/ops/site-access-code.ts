// Sets the pre-launch access code (DR-044). The code is typed twice at a hidden prompt; only
// its scrypt verifier is written to the settings file (SITE_ACCESS_CODE_HASH, with SITE_GATE=on).
// Neither the code nor the verifier is printed. Changing the code signs everyone out.
//   npx tsx --conditions=react-server scripts/ops/site-access-code.ts --env-file .env.staging.local
// Then push the settings to Vercel (scripts/ops/vercel-env-push.ts) and redeploy.
import { hashAccessCode } from "@/server/site-gate";
import { arg, promptHidden, readEnvFile, setEnvValues } from "../lib/env-file";

const MIN_LENGTH = 10;

async function main() {
  const file = readEnvFile(arg("env-file") ?? ".env.staging.local");
  const code = await promptHidden(`Access code (at least ${MIN_LENGTH} characters): `);
  if (code.length < MIN_LENGTH) throw new Error(`the access code needs at least ${MIN_LENGTH} characters`);
  if ((await promptHidden("Type it again: ")) !== code) throw new Error("the two entries differ; nothing was changed");
  setEnvValues(file, { SITE_GATE: "on", SITE_ACCESS_CODE_HASH: await hashAccessCode(code) });
  console.log(`[site-access] SITE_GATE=on and SITE_ACCESS_CODE_HASH written to ${file.path} (the code itself is not stored anywhere).`);
}

main().catch((error) => {
  console.error("[site-access] failed:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
