import fs from "node:fs";
import pg from "pg";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "./fixtures";
import { addSimpleToCart, checkoutToPayment, pay } from "./helpers";

async function delivery(page: Page) {
  await addSimpleToCart(page, "makeup-bag");
  await page.goto("/cart");
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await page.getByLabel("Recipient name").fill("Audit Recipient");
  await page.getByLabel("Delivery phone").fill("0788 555 111");
  await page.getByLabel("E-mail address").fill("buyer@example.com");
  await page.getByRole("button", { name: "Continue to delivery" }).click();
}

test.use({ viewport: { width: 390, height: 844 } });

test("GPS denial plus unavailable search still permits a confirmed manual destination", async ({
  page,
}) => {
  await delivery(page);
  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (_success, failure) =>
      failure?.({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
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
  await page.getByText("Enter a location manually", { exact: true }).click();
  await page.getByLabel("Latitude", { exact: false }).fill("91");
  await page.getByLabel("Longitude", { exact: false }).fill("30.072");
  await page.getByRole("button", { name: "Use these coordinates" }).click();
  await expect(
    page.getByText(
      "Enter a latitude from -90 to 90 and a longitude from -180 to 180.",
    ),
  ).toBeVisible();
  await page.getByLabel("Latitude", { exact: false }).fill("-1.952");
  await page.getByRole("button", { name: "Use these coordinates" }).click();
  await page.getByLabel("Landmark", { exact: false }).fill("Audit blue gate");
  await page
    .getByLabel("Delivery instructions", { exact: false })
    .fill("Call at the gate");
  await page.getByRole("button", { name: "Confirm pin and get fee" }).click();
  await expect(
    page.getByRole("heading", { name: "Review delivery" }),
  ).toBeVisible();
  const address = page.getByRole("region", { name: "Delivery details" });
  await expect(address).toContainText("Audit Recipient");
  await expect(address).toContainText("-1.952000, 30.072000");
  await expect(address).toContainText("Audit blue gate");
  await expect(address).toContainText("Call at the gate");
  await page.getByRole("button", { name: "Accept fee and continue" }).click();
  await expect(address).toContainText("Audit Recipient");
  await expect(
    page.getByRole("button", { name: "Pay RWF 12,000" }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("the optional map loads only after a request and does not change the delivery pin", async ({
  page,
}) => {
  let requests = 0;
  await page.route("https://www.google.com/maps/embed/**", async (route) => {
    requests++;
    const url = new URL(route.request().url());
    expect(url.searchParams.get("key")).toBe("test-browser-key");
    expect(url.searchParams.get("q")).toBe("-1.952,30.072");
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Mock Google map</title><p>Test map preview</p>",
    });
  });
  await delivery(page);
  await page.getByLabel(/Search for a place/).fill("Fixture: 5.0 km");
  await page.getByRole("button", { name: /Fixture: 5\.0 km/ }).click();
  expect(requests).toBe(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "Show street map" }).click();
  await expect(
    page
      .frameLocator('iframe[title="Delivery location on Google Maps"]')
      .getByText("Test map preview"),
  ).toBeVisible();
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Hide street map" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm pin and get fee" }).click();
  await expect(
    page.getByRole("region", { name: "Delivery details" }),
  ).toContainText("-1.952000, 30.072000");
});

test("lost successful add, option edit and removal responses reconcile without repeating the change", async ({
  page,
}) => {
  await page.goto("/products/lip-hue");
  await page
    .getByRole("button", { name: "Choose your shade", exact: true })
    .click();
  await page.getByRole("radio", { name: "Brownie", exact: true }).check();
  await page.getByRole("button", { name: "Use Brownie", exact: true }).click();
  let mutations = 0;
  await page.route("**/api/v1/cart/lines**", async (route) => {
    mutations++;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(page.getByText("Added to cart", { exact: true })).toBeVisible();
  await page.goto("/cart");
  await page.getByRole("button", { name: "Change shade", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Salmon", exact: true }).check();
  await dialog.getByRole("button", { name: "Use Salmon", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("list", { name: "Your cart", exact: true }),
  ).toContainText("Shade: Salmon");
  await expect(
    page
      .getByRole("group", { name: "Quantity: Lip Hue" })
      .getByText("1", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Remove/ }).click();
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
  expect(mutations).toBe(3);
});

test("home section spacing survives the shared container rule at phone and desktop widths", async ({
  page,
}) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const section = page.locator('section[aria-labelledby="edit-heading"]');
    await expect(section).toBeVisible();
    // A single read can land while the streamed page swaps the section, which
    // gives an empty computed style (NaN, main CI run 45151009162); poll it.
    await expect
      .poll(() =>
        section.evaluate((node) =>
          Number.parseFloat(getComputedStyle(node).paddingBlockStart),
        ),
      )
      .toBeGreaterThanOrEqual(28);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
});

test("editing a quoted recipient saves the new contact before payment, including after reload", async ({
  page,
}) => {
  await delivery(page);
  await page.getByLabel(/Search for a place/).fill("Fixture: 5.0 km");
  await page.getByRole("button", { name: /Fixture: 5\.0 km/ }).click();
  await page.getByRole("button", { name: "Confirm pin and get fee" }).click();
  await expect(
    page.getByRole("region", { name: "Delivery details" }),
  ).toContainText("Audit Recipient");
  await page.getByRole("button", { name: "Edit contact", exact: true }).click();
  await page.getByLabel("Recipient name").fill("Updated Audit Recipient");
  await page.getByLabel("Delivery phone").fill("0788 555 222");
  await page.getByRole("button", { name: "Continue to delivery" }).click();
  await expect(
    page.getByRole("heading", { name: "Where should we deliver?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm pin and get fee" }).click();
  await expect(
    page.getByRole("region", { name: "Delivery details" }),
  ).toContainText("Updated Audit Recipient");
  await page.getByRole("button", { name: "Accept fee and continue" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Review and pay" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Delivery details" }),
  ).toContainText("Updated Audit Recipient");
  await expect(
    page.getByRole("region", { name: "Delivery details" }),
  ).toContainText("222");
});

test("non-shade products use option wording and show an explicit price range", async ({
  page,
}) => {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(".env.test", "utf8").split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0 && !line.startsWith("#"))
      env[line.slice(0, at)] = line.slice(at + 1);
  }
  if (
    env.APP_ENV !== "test" ||
    !new URL(env.MIGRATION_DATABASE_URL!).pathname.endsWith("beautybox_test")
  )
    throw new Error("TEST target only");
  const client = new pg.Client({
    connectionString: env.MIGRATION_DATABASE_URL,
  });
  await client.connect();
  const { rows: products } = await client.query(
    "SELECT id, option_label FROM commerce.products WHERE slug='lip-hue'",
  );
  const product = products[0];
  const { rows: variants } = await client.query(
    "SELECT id,attributes,price_rwf FROM commerce.variants WHERE product_id=$1 ORDER BY sort_order",
    [product.id],
  );
  try {
    await client.query(
      "UPDATE commerce.products SET option_label='Size' WHERE id=$1",
      [product.id],
    );
    for (const [i, variant] of variants.entries())
      await client.query(
        "UPDATE commerce.variants SET attributes=$1, price_rwf=$2 WHERE id=$3",
        [
          JSON.stringify({ size: i === 0 ? "Small" : `Size ${i + 1}` }),
          12000 + i * 1000,
          variant.id,
        ],
      );
    await page.goto("/products/lip-hue");
    await expect(
      page
        .getByText("No option selected", { exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText("From", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Choose your option", exact: true })
      .click();
    await page.getByRole("radio", { name: "Small", exact: true }).check();
    await page.getByRole("button", { name: "Use Small", exact: true }).click();
    await expect(
      page
        .getByText("Selected option: Small", { exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
  } finally {
    await client.query(
      "UPDATE commerce.products SET option_label=$1 WHERE id=$2",
      [product.option_label, product.id],
    );
    for (const variant of variants)
      await client.query(
        "UPDATE commerce.variants SET attributes=$1, price_rwf=$2 WHERE id=$3",
        [JSON.stringify(variant.attributes), variant.price_rwf, variant.id],
      );
    await client.end();
  }
});

test("all staff workspace entry pages fit phone width and pass automated accessibility checks", async ({
  page,
}) => {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(".env.test", "utf8").split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0 && !line.startsWith("#"))
      env[line.slice(0, at)] = line.slice(at + 1);
  }
  if (
    env.APP_ENV !== "test" ||
    !new URL(env.MIGRATION_DATABASE_URL!).pathname.endsWith("beautybox_test")
  )
    throw new Error("TEST target only");
  const client = new pg.Client({
    connectionString: env.MIGRATION_DATABASE_URL,
  });
  await client.connect();
  await addSimpleToCart(page, "detangling-comb");
  await checkoutToPayment(page);
  await pay(page, "+250788123000");
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 90000 });
  const authId = crypto.randomUUID();
  try {
    await client.query(
      "INSERT INTO commerce.staff_members (auth_user_id,email,display_name,role) VALUES ($1,$2,$3,'ADMIN')",
      [authId, `audit-${authId}@example.test`, "Audit Admin"],
    );
  } finally {
    await client.end();
  }
  await page.setExtraHTTPHeaders({ "x-test-staff": `${authId}:aal2` });
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of [
    "/staff",
    "/staff/orders",
    "/staff/catalog",
    "/staff/stock",
    "/staff/stock/import",
    "/staff/finance",
    "/staff/suppliers",
    "/staff/team",
    "/staff/settings",
  ]) {
    await page.goto(path);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
      path,
    ).toBeLessThanOrEqual(1);
    if (path === "/staff/orders") {
      await expect(
        page.getByRole("list", { name: "Order cards" }),
      ).toContainText("Paid, to prepare");
      await expect(
        page.getByRole("region", { name: "Orders", exact: true }),
      ).toBeHidden();
    }
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      result.violations.map((v) => v.id),
      path,
    ).toEqual([]);
  }
});
