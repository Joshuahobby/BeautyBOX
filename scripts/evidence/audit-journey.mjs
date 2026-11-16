// Audit the local TEST build only. Captures use synthetic data and fake payments.
import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const origin = "http://localhost:3100";
const directory =
  process.env.BEAUTYBOX_AUDIT_DIR ?? "docs/evidence/detail-audit/before";
fs.mkdirSync(directory, { recursive: true });
const browser = await chromium.launch();
const steps = [],
  errors = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
  permissions: [],
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
async function capture(name, fullPage = true) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const image of document.images) image.loading = "eager";
    await Promise.all(
      [...document.images].map((image) => image.decode().catch(() => {})),
    );
    window.scrollTo({ top: 0, behavior: "instant" });
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  const dimensions = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    brokenImages: [...document.images].filter((image) => !image.naturalWidth)
      .length,
  }));
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage });
  steps.push({
    name,
    path: new URL(page.url()).pathname,
    viewport: page.viewportSize(),
    ...dimensions,
    axe: axe.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.flatMap((n) => n.target),
    })),
  });
}
try {
  await page.goto(origin, { waitUntil: "networkidle" });
  await expect(
    page.getByText(/Demo environment: synthetic products/),
  ).toBeVisible();
  await capture("01-home-desktop");
  await page
    .getByRole("navigation", { name: "Shop departments" })
    .getByRole("button", { name: "Skincare", exact: true })
    .click();
  await capture("02-mega-menu", false);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("03-home-mobile");
  await page.goto(origin + "/shop?category=makeup&maxPriceRwf=15000", {
    waitUntil: "networkidle",
  });
  await capture("04-catalog-filtered");
  await page.setViewportSize({ width: 1003, height: 900 });
  await page.goto(origin + "/products/lip-hue", { waitUntil: "networkidle" });
  await capture("05-product");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Choose your shade", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Brownie", exact: true }).check();
  await capture("06-shade", false);
  await dialog
    .getByRole("button", { name: "Use Brownie", exact: true })
    .click();
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(page.getByText("Added to cart", { exact: true })).toBeVisible();
  await page.goto(origin + "/cart", { waitUntil: "networkidle" });
  await capture("07-cart", false);
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await page.getByLabel("Recipient name").fill("Audit Demo Recipient");
  await page.getByLabel("Delivery phone").fill("0788 555 111");
  await page.getByRole("button", { name: "Continue to delivery" }).click();
  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (_success, failure) =>
      failure?.({ code: 1, PERMISSION_DENIED: 1 });
  });
  await page.route("**/api/v1/places?*", (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: "PROVIDER_UNAVAILABLE",
        message:
          "Place search is unavailable. You can still place the pin manually.",
      },
    }),
  );
  await page.getByRole("button", { name: "Use my current location" }).click();
  await page.getByLabel(/Search for a place/).fill("Kigali");
  await expect(
    page.getByText(
      "Place search is unavailable. You can still place the pin manually.",
    ),
  ).toBeVisible();
  if (
    await page.getByText("Enter a location manually", { exact: true }).count()
  ) {
    await page.getByText("Enter a location manually", { exact: true }).click();
    await page.getByLabel("Latitude", { exact: true }).fill("-1.952");
    await page.getByLabel("Longitude", { exact: true }).fill("30.072");
    await page.getByRole("button", { name: "Use these coordinates" }).click();
  }
  await capture("08-location-denied-and-search-unavailable");
  await page.unroute("**/api/v1/places?*");
  await page.getByLabel(/Search for a place/).fill("Fixture: 5.0 km");
  await page.getByRole("button", { name: /Fixture: 5\.0 km/ }).click();
  await page.getByRole("button", { name: "Confirm pin and get fee" }).click();
  await expect(
    page.getByRole("heading", { name: "Review delivery" }),
  ).toBeVisible();
  await capture("09-delivery-review");
  await page.getByRole("button", { name: "Accept fee and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Review and pay" }),
  ).toBeVisible();
  await capture("10-payment-review");
  await page.getByLabel("MTN MoMo").check();
  await page.getByLabel("Paying phone").fill("+250788123000");
  await page.getByRole("button", { name: /^Pay RWF/ }).click();
  await expect(
    page.getByRole("heading", { name: "Approve on your phone" }),
  ).toBeVisible();
  await capture("11-payment-pending");
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 90000 });
  await capture("12-confirmed-order");
  await page.goto(origin + "/cart");
  await capture("13-empty-cart");
  await page.goto(origin + "/shop?q=zzzauditnomatches");
  await capture("14-no-results");
  // Synthetic staff identity in the local TEST database, never a hosted account.
  const env = {};
  for (const line of fs.readFileSync(".env.test", "utf8").split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0 && !line.startsWith("#"))
      env[line.slice(0, at)] = line.slice(at + 1);
  }
  if (
    env.APP_ENV !== "test" ||
    !new URL(env.MIGRATION_DATABASE_URL).pathname.endsWith("beautybox_test")
  )
    throw new Error("TEST database required");
  const client = new pg.Client({
    connectionString: env.MIGRATION_DATABASE_URL,
  });
  const id = crypto.randomUUID();
  await client.connect();
  try {
    await client.query(
      "INSERT INTO commerce.staff_members (auth_user_id,email,display_name,role) VALUES ($1,$2,$3,'ADMIN')",
      [id, `audit-${id}@example.test`, "Audit Test Admin"],
    );
  } finally {
    await client.end();
  }
  await page.setExtraHTTPHeaders({ "x-test-staff": `${id}:aal2` });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(origin + "/staff/settings", { waitUntil: "networkidle" });
  await capture("15-staff-settings-mobile");
  await page.goto(origin + "/staff/catalog", { waitUntil: "networkidle" });
  await capture("16-staff-catalog-mobile");
  await page.goto(origin + "/help/delivery-returns", {
    waitUntil: "networkidle",
  });
  await capture("17-delivery-help");
  await page.setExtraHTTPHeaders({});
  await page.goto(origin + "/products/makeup-bag");
  await page.route("**/api/v1/cart/lines", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(page.getByText("Added to cart", { exact: true })).toBeVisible();
  await capture("18-lost-add-response-recovered");
  await page.setExtraHTTPHeaders({ "x-test-staff": `${id}:aal2` });
  await page.goto(origin + "/staff/orders", { waitUntil: "networkidle" });
  await capture("19-staff-order-cards");
  await page.setExtraHTTPHeaders({});

  fs.writeFileSync(
    directory + "/observations.json",
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        mode: "local TEST production build, synthetic data, fake providers",
        steps,
        errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      screenshots: steps.length,
      overflow: steps.filter((s) => s.overflow > 1).map((s) => s.name),
      axeIssues: steps
        .filter((s) => s.axe.length)
        .map((s) => ({ name: s.name, axe: s.axe })),
      consoleErrors: errors.length,
    }),
  );
} finally {
  await browser.close();
}
