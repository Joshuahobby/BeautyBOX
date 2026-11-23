// Curated PNG evidence only. Raw traces and private environment files stay ignored.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium, expect, type Page } from "@playwright/test";
import { ownerQuery, staffMember } from "../../tests/e2e/readiness-support";
import { STOCK_CSV_HEADER } from "../../src/lib/stock-csv";
import { randomUUID } from "node:crypto";
const origin = process.env.BEAUTYBOX_PREVIEW_ORIGIN ?? "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Local TEST capture only.");
const directory = "docs/evidence/readiness";
fs.mkdirSync(directory, { recursive: true });
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const captures: {
  name: string;
  viewport: unknown;
  overflow: number;
  brokenImages: string[];
}[] = [];
async function capture(page: Page, name: string, fullPage = true) {
  await page.locator("img").evaluateAll(async (images) => {
    for (const image of images as HTMLImageElement[]) image.loading = "eager";
    await Promise.all(
      (images as HTMLImageElement[]).map((image) =>
        image.decode().catch(() => {}),
      ),
    );
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - innerWidth,
  );
  const broken = await page
    .locator("img")
    .evaluateAll((images) =>
      (images as HTMLImageElement[])
        .filter(
          (image) =>
            image.getBoundingClientRect().width > 0 && !image.naturalWidth,
        )
        .map((image) => image.getAttribute("src") ?? "missing"),
    );
  if (overflow > 1 || broken.length)
    throw new Error(`Invalid capture ${name}: overflow or broken images`);
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage });
  captures.push({
    name,
    viewport: page.viewportSize(),
    overflow,
    brokenImages: broken,
  });
}
try {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  await capture(page, "home-mobile");
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture(page, "home-desktop");
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto("/products/lip-hue", { waitUntil: "networkidle" });
  await capture(page, "product-mobile");
  await context.setExtraHTTPHeaders({
    "x-test-staff": await staffMember("OPERATIONS"),
  });
  const product = await ownerQuery(
    "SELECT id FROM commerce.products WHERE slug LIKE 'readiness-serum-%' ORDER BY created_at DESC LIMIT 1",
  );
  const variant = product.rows[0]
    ? await ownerQuery(
        "SELECT sku FROM commerce.variants WHERE product_id=$1 ORDER BY sort_order LIMIT 1",
        [product.rows[0].id],
      )
    : null;
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(
      product.rows[0]
        ? `/staff/catalog/${product.rows[0].id}`
        : "/staff/catalog/new",
      { waitUntil: "networkidle" },
    );
    await capture(page, `staff-product-${width}`);
    await page.goto("/staff/stock/import", { waitUntil: "networkidle" });
    if (variant?.rows[0]) {
      const csv = `${STOCK_CSV_HEADER.join(",")}\n${variant.rows[0].sku},1,OWNED,,,REVIEW-${randomUUID().slice(0, 8)},2028-02-29,500\n`;
      await page.getByLabel("CSV rows", { exact: true }).fill(csv);
      await page
        .getByRole("button", { name: "Preview import", exact: true })
        .click();
      await expect(
        page.getByText("READY: 1 of 1 rows valid", { exact: true }),
      ).toBeVisible();
      await page
        .getByLabel("Reason / count reference")
        .fill("Isolated TEST evidence; not a launch count");
    }
    await capture(page, `staff-import-${width}`);
    if (width === 320 && variant?.rows[0]) {
      let calls = 0;
      await page.route(
        "**/api/v1/staff/inventory/import-previews/*/apply",
        async (route) => {
          const response = await route.fetch();
          if (++calls === 1) await route.abort("failed");
          else await route.fulfill({ response });
        },
      );
      await page
        .getByRole("button", { name: "Apply import", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Check import outcome", exact: true }),
      ).toBeVisible();
      await capture(page, "staff-import-uncertain-320");
      await page
        .getByRole("button", { name: "Check import outcome", exact: true })
        .click();
      await expect(
        page.getByText("APPLIED: 1 of 1 rows valid", { exact: true }),
      ).toBeVisible();
      if (calls !== 2)
        throw new Error("Unexpected import recovery request count.");
      await page.unroute("**/api/v1/staff/inventory/import-previews/*/apply");
    }
  }
  await page.goto("/staff/feedback-preview?fail=1&delay=1500", {
    waitUntil: "commit",
  });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Loading workspace" })
      .filter({ visible: true }),
  ).toBeVisible();
  await capture(page, "staff-loading", false);
  await expect(
    page.getByRole("heading", { name: "We couldn’t load this page" }),
  ).toBeVisible();
  await capture(page, "staff-recovery", false);
  await context.addCookies([
    { name: "bb-test-read-recovered", value: "1", url: origin },
  ]);
  await page.getByRole("button", { name: "Try loading again" }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace read recovered" }),
  ).toBeVisible();
  const order = await ownerQuery(
    "SELECT id FROM commerce.orders WHERE state='PREPARING' ORDER BY created_at DESC LIMIT 1",
  );
  if (order.rows[0]) {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/staff/orders/${order.rows[0].id}`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: "Assign rider", exact: true })
      .click();
    await capture(page, "staff-order-dialog-320", false);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await context.setExtraHTTPHeaders({
      "x-test-staff": await staffMember("FINANCE"),
    });
    await page.reload();
    const approve = page
      .getByRole("button", { name: /^Approve refund/ })
      .first();
    if (await approve.count()) {
      await approve.click();
      await capture(page, "staff-finance-dialog-320", false);
    }
  }
  await context.close();
} finally {
  await browser.close();
}
fs.writeFileSync(
  `${directory}/captures.json`,
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      sourceCommit,
      mode: "local production build; isolated TEST data and fake providers",
      captures,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Saved ${captures.length} direct PNG previews with zero page overflow or broken images.`,
);
