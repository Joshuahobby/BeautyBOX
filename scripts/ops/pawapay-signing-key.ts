// pawaPay request-signing key for the SANDBOX (DR-042, DR-043). Two steps, so the private key is
// never typed, pasted or printed:
//   1. npx tsx scripts/ops/pawapay-signing-key.ts generate
//        writes .local/pawapay-signing/public.pem  (upload it in the sandbox dashboard, API Security)
//        and    .local/pawapay-signing/private.pem (stays on this machine)
//   2. npx tsx scripts/ops/pawapay-signing-key.ts install --key-id <the id the dashboard shows>
//        writes PAWAPAY_SIGNING_PRIVATE_KEY and PAWAPAY_SIGNING_KEY_ID into .env.local, then
//        deletes private.pem. Refused unless .env.local has PAWAPAY_MODE=sandbox.
//   npx tsx scripts/ops/pawapay-signing-key.ts uninstall   removes both settings again.
// Production keys are made on the machine that manages production secrets and go into the
// deployment's secret store, never into a developer's .env.local.
import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parsePrivateKey } from "@/adapters/payments/http-signatures";
import { restrictToCurrentUser } from "../lib/env-file";

// The app folder; SIGNING_KEY_ROOT only lets the script be tried on a copy.
const root = process.env.SIGNING_KEY_ROOT ?? process.cwd();
const envFile = path.join(root, ".env.local");
const dir = path.join(root, ".local", "pawapay-signing");
const publicFile = path.join(dir, "public.pem");
const privateFile = path.join(dir, "private.pem");
const NAMES = ["PAWAPAY_SIGNING_PRIVATE_KEY", "PAWAPAY_SIGNING_KEY_ID"] as const;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readEnvLines(): string[] {
  if (!fs.existsSync(envFile)) fail("No .env.local in this folder.");
  return fs.readFileSync(envFile, "utf8").split(/\r?\n/);
}

/** The last assignment wins, as when the app loads the file. */
function envValue(lines: string[], name: string): string | undefined {
  let value: string | undefined;
  for (const line of lines) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (m && m[1] === name) value = m[2]!.trim().replace(/^"(.*)"$/, "$1");
  }
  return value;
}

function writeEnv(lines: string[], set: Partial<Record<(typeof NAMES)[number], string>>) {
  const kept = lines.filter((line) => !NAMES.some((name) => new RegExp(`^\\s*${name}\\s*=`).test(line)));
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  for (const name of NAMES) if (set[name]) kept.push(`${name}=${set[name]}`);
  fs.writeFileSync(envFile, `${kept.join("\n")}\n`);
}

function generate(force: boolean) {
  if (fs.existsSync(privateFile) && !force) fail(`${path.relative(root, privateFile)} already exists; install it, or pass --force to replace it.`);
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  fs.mkdirSync(dir, { recursive: true });
  // Limited to this Windows user before the key is written (mode 600 does nothing on Windows).
  fs.writeFileSync(privateFile, "", { mode: 0o600 });
  restrictToCurrentUser(privateFile);
  fs.writeFileSync(privateFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  fs.writeFileSync(publicFile, publicKey.export({ type: "spki", format: "pem" }));
  console.log(`EC P-256 key pair created.
  Public key (upload this in the sandbox dashboard, API Security): ${path.relative(root, publicFile)}
  Private key (stays here until installed): ${path.relative(root, privateFile)}
Then run: npx tsx scripts/ops/pawapay-signing-key.ts install --key-id <the id the dashboard shows>`);
}

function install(keyId: string | undefined) {
  if (!keyId || !/^[\x21-\x7e]{1,200}$/.test(keyId)) fail("Give the key id the dashboard shows: install --key-id <id> (printable characters, no spaces).");
  const lines = readEnvLines();
  if (envValue(lines, "PAWAPAY_MODE") !== "sandbox") fail("Refused: .env.local must have PAWAPAY_MODE=sandbox. Production keys belong in the deployment's secret store.");
  if (!fs.existsSync(privateFile) || !fs.existsSync(publicFile)) fail("No generated key pair: run `generate` first.");
  const pem = fs.readFileSync(privateFile, "utf8").trim();
  const key = parsePrivateKey(pem);
  // The private key must belong to the public key that was uploaded.
  const probe = Buffer.from("beautybox-signing-check");
  if (!verify("sha256", probe, createPublicKey(fs.readFileSync(publicFile, "utf8")), sign("sha256", probe, key))) fail("private.pem does not match public.pem; generate a new pair.");
  writeEnv(lines, { PAWAPAY_SIGNING_PRIVATE_KEY: pem.replace(/\r?\n/g, "\\n"), PAWAPAY_SIGNING_KEY_ID: keyId });
  fs.rmSync(privateFile);
  console.log(`Installed in .env.local: PAWAPAY_SIGNING_PRIVATE_KEY (${pem.length} characters), PAWAPAY_SIGNING_KEY_ID (${keyId.length} characters).
Removed ${path.relative(root, privateFile)}. Restart npm run dev and the worker so they sign deposit and refund requests.`);
}

function uninstall() {
  const lines = readEnvLines();
  writeEnv(lines, {});
  console.log("Removed PAWAPAY_SIGNING_PRIVATE_KEY and PAWAPAY_SIGNING_KEY_ID from .env.local. Restart npm run dev and the worker.");
}

const [command, ...rest] = process.argv.slice(2);
const keyIdAt = rest.indexOf("--key-id");
if (command === "generate") generate(rest.includes("--force"));
else if (command === "install") install(keyIdAt >= 0 ? rest[keyIdAt + 1] : undefined);
else if (command === "uninstall") uninstall();
else fail("Usage: pawapay-signing-key.ts generate [--force] | install --key-id <id> | uninstall");
