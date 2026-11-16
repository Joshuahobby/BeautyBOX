// Local TEST production preview only; no real Places, Routes, payments or SMS.
import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
const origin = process.env.BEAUTYBOX_PREVIEW_ORIGIN ?? "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Local preview only.");
const directory = "docs/evidence/delivery-rebuild";
fs.mkdirSync(directory, { recursive: true });
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  await page.goto(origin + "/products/makeup-bag");
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(page.getByText("Added to cart", { exact: true })).toBeVisible();
  await page.goto(origin + "/cart");
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await page.getByLabel("Recipient name").fill("Demo Recipient");
  await page.getByLabel("Delivery phone").fill("0788 555 111");
  await page.getByRole("button", { name: "Continue to delivery" }).click();
  await page.getByLabel(/Search for a place/).fill("Fixture: 5.0 km");
  await page.getByRole("button", { name: /Fixture: 5\.0 km/ }).click();
  await page.getByRole("button", { name: "Confirm pin and get fee" }).click();
  await expect(
    page.getByRole("heading", { name: "Review delivery" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Order summary" }),
  ).toContainText("RWF 2,000");
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, behavior: "instant" });
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  await page.screenshot({
    path: directory + "/delivery-review-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Accept fee and continue" }).click();
  await expect(
    page.getByRole("button", { name: "Pay RWF 12,000" }),
  ).toBeVisible();
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, behavior: "instant" });
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  await page.screenshot({
    path: directory + "/payment-review-mobile.png",
    fullPage: true,
  });
  if (errors.length)
    throw new Error("Browser errors while capturing delivery review.");
  fs.writeFileSync(
    directory + "/browser-capture.json",
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        mode: "local production build; TEST demo data; simulated 5km route; no live provider calls",
        viewport: page.viewportSize(),
        deliveryFeeRwf: 2000,
        merchandiseRwf: 10000,
        totalRwf: 12000,
        browserErrors: errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Saved mobile delivery and payment review; RWF 2,000 simulated delivery; no browser errors.",
  );
} finally {
  await browser.close();
}
