#!/usr/bin/env node
// Builds the self-hosted Manrope web font from the supplied variable TTF (handoff
// assets/fonts, SIL OFL 1.1). Output: one WOFF2 limited to the weights the design uses
// (400-700) and the characters needed for English, Kinyarwanda and French launch copy,
// prices and UI symbols. The OFL licence travels with the font (src/design/fonts).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const subsetFont = require("subset-font");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = path.join(root, "src", "design", "source", "Manrope-Variable.ttf");
const target = path.join(root, "src", "design", "fonts", "Manrope-latin-ext-wght400-700.woff2");

const ranges = [
  [0x20, 0x7e], // Basic Latin
  [0xa0, 0xff], // Latin-1 Supplement (French accents, ×, ·, non-breaking space)
  [0x100, 0x17f], // Latin Extended-A
  [0x2010, 0x2027], // dashes, quotes, bullet •, ellipsis …
  [0x2030, 0x203a], // per mille, guillemets
  [0x2190, 0x2193], // arrows ← ↑ → ↓
  [0x2212, 0x2212], // minus sign
];
let text = "";
for (const [from, to] of ranges) for (let c = from; c <= to; c++) text += String.fromCodePoint(c);

const input = fs.readFileSync(source);
const output = await subsetFont(input, text, {
  targetFormat: "woff2",
  variationAxes: { wght: { min: 400, max: 700 } },
});
fs.writeFileSync(target, output);
console.log(`wrote ${path.relative(root, target)}: ${(output.length / 1024).toFixed(1)} KiB (source ${(input.length / 1024).toFixed(1)} KiB)`);
