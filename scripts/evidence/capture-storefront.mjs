// Local-only visual evidence capture. Start the app with the demo TEST providers first.
import fs from "node:fs";
import { chromium } from "@playwright/test";
const origin = process.env.BEAUTYBOX_PREVIEW_ORIGIN ?? "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Capture only a local preview.");
const directory = "docs/evidence/storefront-rebuild";
fs.mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const captures = [];
try {
  for (const [name, pathname, width] of [
    ["home-desktop", "/", 1003],
    ["home-mobile", "/", 360],
    ["catalog-desktop", "/shop", 1440],
    ["catalog-mobile", "/shop?category=makeup", 360],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(origin + pathname, { waitUntil: "networkidle" });
    await page.locator("img").evaluateAll(async (images) => {
      for (const image of images) image.loading = "eager";
      await Promise.all(images.map((image) => image.decode().catch(() => {})));
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    const broken = await page
      .locator("img")
      .evaluateAll((images) =>
        images
          .filter((image) => image.naturalWidth === 0)
          .map((image) => image.getAttribute("src")),
      );
    if (overflow > 1 || broken.length)
      throw new Error("Capture has overflow or broken images: " + name);
    await page.screenshot({
      path: directory + "/" + name + ".png",
      fullPage: true,
    });
    captures.push({
      name,
      pathname,
      cssViewport: { width, height: 900 },
      deviceScaleFactor: 1,
      overflow,
      brokenImages: broken,
    });
    if (name === "home-desktop") {
      await page
        .getByRole("navigation", { name: "Shop departments" })
        .getByRole("button", { name: "Skincare", exact: true })
        .click();
      await page.screenshot({ path: directory + "/mega-menu.png" });
    }
    await page.close();
  }
  if (errors.length)
    throw new Error("Browser errors; inspect the local capture.");
  fs.writeFileSync(
    directory + "/browser-capture.json",
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        mode: "local production build, TEST database, fake providers",
        captures,
        pageAndConsoleErrors: errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Saved four page captures and the open mega menu; no broken images, overflow or browser errors.",
  );
} finally {
  await browser.close();
}
