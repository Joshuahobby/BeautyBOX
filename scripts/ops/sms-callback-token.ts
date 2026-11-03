// Makes the secret delivery-report address for Africa's Talking (DR-048). Africa's Talking does
// not sign its callbacks, so the address itself carries a random token
// (AFRICASTALKING_CALLBACK_TOKEN); the app refuses reports sent anywhere else (404).
//   npx tsx scripts/ops/sms-callback-token.ts --env-file .env.staging.local [--rotate] [--print]
// Keeps an existing token unless --rotate is given. The full address is copied to the clipboard
// (printed only with --print) for the Africa's Talking dashboard: SMS > SMS Callback URLs >
// Delivery Reports, in the same account (sandbox or live) as AFRICASTALKING_USERNAME. Then push the
// settings (scripts/ops/vercel-env-push.ts) and redeploy. Rotating stops the old address at once.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { arg, envValue, readEnvFile, setEnvValues } from "../lib/env-file";

const PATH = "/api/v1/callbacks/africastalking/delivery-reports/";

function copyToClipboard(text: string): boolean {
  const command = process.platform === "win32" ? "clip" : process.platform === "darwin" ? "pbcopy" : null;
  if (!command) return false;
  return spawnSync(command, [], { input: text, shell: process.platform === "win32" }).status === 0;
}

function main() {
  const file = readEnvFile(arg("env-file") ?? ".env.staging.local");
  const origin = envValue(file, "APP_ORIGIN");
  if (!origin || !/^https?:\/\//.test(origin)) throw new Error("APP_ORIGIN must be set in the file (the public address Africa's Talking will call)");
  let token = envValue(file, "AFRICASTALKING_CALLBACK_TOKEN");
  const rotate = process.argv.includes("--rotate");
  if (!token || rotate) {
    token = randomBytes(32).toString("base64url");
    setEnvValues(file, { AFRICASTALKING_CALLBACK_TOKEN: token });
    console.log(`[sms-callback] ${rotate ? "new" : "made"} AFRICASTALKING_CALLBACK_TOKEN written to ${file.path}.`);
  } else {
    console.log(`[sms-callback] keeping the AFRICASTALKING_CALLBACK_TOKEN already in ${file.path} (use --rotate for a new one).`);
  }
  const address = `${origin.replace(/\/+$/, "")}${PATH}${token}`;
  if (process.argv.includes("--print")) {
    console.log(`[sms-callback] delivery-report address: ${address}`);
  } else if (copyToClipboard(address)) {
    console.log(`[sms-callback] delivery-report address copied to the clipboard: ${origin.replace(/\/+$/, "")}${PATH}${token.slice(0, 4)}...`);
  } else {
    console.log("[sms-callback] no clipboard here; run again with --print to show the address.");
  }
  console.log("[sms-callback] paste it in the Africa's Talking dashboard under SMS > SMS Callback URLs > Delivery Reports, then push the settings and redeploy.");
}

try {
  main();
} catch (error) {
  console.error("[sms-callback] failed:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
}
