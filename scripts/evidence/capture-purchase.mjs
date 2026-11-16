// Run against a local, freshly seeded TEST preview with fake providers.
import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
const origin = process.env.BEAUTYBOX_PREVIEW_ORIGIN ?? "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Local preview only.");
const directory = "docs/evidence/purchase-rebuild";
fs.mkdirSync(directory, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const captures = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1003, height: 900 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  async function capture(name) {
    await page.locator("img").evaluateAll(async (images) => {
      for (const image of images) image.loading = "eager";
      await Promise.all(images.map((image) => image.decode().catch(() => {})));
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    const broken = await page
      .locator("img")
      .evaluateAll(
        (images) => images.filter((image) => image.naturalWidth === 0).length,
      );
    if (overflow > 1 || broken) throw new Error("Invalid capture: " + name);
    await page.screenshot({
      path: directory + "/" + name + ".png",
      fullPage: !["shade-mobile", "cart-mobile"].includes(name),
    });
    captures.push({
      name,
      viewport: page.viewportSize(),
      overflow,
      brokenImages: broken,
    });
  }
  await page.goto(origin + "/products/lip-hue", { waitUntil: "networkidle" });
  await capture("product-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("product-mobile");
  await page
    .getByRole("button", { name: "Choose your shade", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Choose a shade" });
  await dialog.getByRole("radio", { name: "Rosy", exact: true }).check();
  await capture("shade-mobile");
  await dialog.getByRole("button", { name: "Use Rosy", exact: true }).click();
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(page.getByText("Added to cart", { exact: true })).toBeVisible();
  await page.goto(origin + "/products/pure-zen-cleanser");
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(page.getByText("Added to cart", { exact: true })).toBeVisible();
  await page.goto(origin + "/cart", { waitUntil: "networkidle" });
  await expect(
    page
      .getByRole("list", { name: "Your cart", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(2);
  await expect(
    page.getByRole("complementary", { name: "Order summary" }),
  ).toContainText("RWF 27,000");
  await capture("cart-mobile");
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await expect(
    page.getByRole("heading", { name: "Who is receiving?" }),
  ).toBeVisible();
  await capture("checkout-mobile");
  if (errors.length)
    throw new Error("Browser errors while capturing purchase pages.");
  fs.writeFileSync(
    directory + "/browser-capture.json",
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        mode: "local production build; TEST demo data; fake providers",
        captures,
        browserErrors: errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Saved product, shade, cart and checkout previews; no overflow, broken images or browser errors.",
  );
} finally {
  await browser.close();
}
