#!/usr/bin/env node
// The original generator required an external v1.0 handoff that is no longer present.
// Use the exact committed v1.1 contract as the immutable baseline for later additions.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const baselinePath = path.join(
  root,
  "docs/api/baseline/API-Contract-v1.1.openapi.json",
);
const baseline = fs.readFileSync(baselinePath);
const expected =
  "6922d9c35452af687e1ce9884dff15495f7a640a47decc33bfe2061909f8f36c";
if (createHash("sha256").update(baseline).digest("hex") !== expected)
  throw new Error("Immutable v1.1 contract baseline changed.");
const contract = JSON.parse(baseline);
const output = JSON.stringify(contract, null, 2) + "\n";
const target = path.join(root, "docs/api/API-Contract-v1.1.openapi.json");
if (process.argv.includes("--check")) {
  if (fs.readFileSync(target, "utf8") !== output)
    throw new Error(
      "Contract differs from the pinned baseline; document and generate any additions explicitly.",
    );
  console.log("[contract] matches pinned committed v1.1 baseline");
} else {
  fs.writeFileSync(target, output);
  console.log("[contract] wrote v1.1 from pinned baseline");
}
