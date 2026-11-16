// Derive responsive copies only from the checked-in editorial/demo originals.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
const root = path.resolve(import.meta.dirname, "../..");
const directory = path.join(root, "public/images/editorial");
const manifestFile = path.join(root, "src/lib/responsive-images.json");
const transform = {
  widths: [320, 480, 768],
  format: "webp",
  quality: 78,
  effort: 6,
  fit: "inside",
  withoutEnlargement: true,
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sources = (await fs.readdir(directory))
  .filter((name) => name.endsWith(".webp"))
  .sort();
if (sources.length !== 17)
  throw new Error(
    "Review the source list before adding or removing editorial assets.",
  );
if (process.argv.includes("--check")) {
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  if (
    JSON.stringify(manifest.transform) !== JSON.stringify(transform) ||
    Object.keys(manifest.images).length !== sources.length
  )
    throw new Error(
      "Responsive image configuration changed; regenerate assets.",
    );
  for (const source of sources) {
    const image = manifest.images[`/images/editorial/${source}`];
    if (
      !image ||
      hash(await fs.readFile(path.join(directory, source))) !==
        image.sourceSha256 ||
      image.variants.length !== transform.widths.length
    )
      throw new Error(`Source image changed: ${source}`);
    for (const variant of image.variants)
      if (
        hash(await fs.readFile(path.join(root, "public", variant.url))) !==
        variant.sha256
      )
        throw new Error(`Responsive image changed: ${variant.url}`);
  }
  console.log("Responsive image hashes match all 17 sources and 51 variants.");
} else {
  await fs.mkdir(path.join(directory, "responsive"), { recursive: true });
  const images = {};
  for (const source of sources) {
    const bytes = await fs.readFile(path.join(directory, source));
    const metadata = await sharp(bytes).metadata();
    const variants = [];
    for (const width of transform.widths) {
      const url = `/images/editorial/responsive/${source.replace(/\.webp$/, "")}-${width}.webp`;
      const result = await sharp(bytes)
        .resize({ width, fit: "inside", withoutEnlargement: true })
        .webp({ quality: transform.quality, effort: transform.effort })
        .toBuffer({ resolveWithObject: true });
      await fs.writeFile(path.join(root, "public", url), result.data);
      variants.push({
        url,
        width: result.info.width,
        height: result.info.height,
        bytes: result.data.length,
        sha256: hash(result.data),
      });
    }
    images[`/images/editorial/${source}`] = {
      width: metadata.width,
      height: metadata.height,
      bytes: bytes.length,
      sourceSha256: hash(bytes),
      variants,
    };
  }
  await fs.writeFile(
    manifestFile,
    JSON.stringify({ transform, images }, null, 2) + "\n",
  );
  console.log(
    "Generated 51 responsive WebP copies; originals and provenance are unchanged.",
  );
}
