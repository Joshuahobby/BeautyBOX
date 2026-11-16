import { randomUUID } from "node:crypto";
import sharp from "sharp";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import {
  addSimpleToCart,
  checkoutToPayment,
  expectNoHorizontalScroll,
  pay,
} from "./helpers";
import { ownerQuery, staffMember } from "./readiness-support";
import { STOCK_CSV_HEADER } from "../../src/lib/stock-csv";

for (const width of [320, 360]) {
  test(`staff product, variants, real photo upload and CSV recovery at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.setExtraHTTPHeaders({
      "x-test-staff": await staffMember("OPERATIONS"),
    });
    await page.goto("/staff/catalog/new");
    const suffix = randomUUID().slice(0, 8);
    await page
      .getByLabel("Product name", { exact: true })
      .fill(`Readiness Serum ${suffix}`);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByLabel("Web address (slug)")).toBeFocused();
    await expect(page.getByLabel("Product name", { exact: true })).toHaveValue(
      `Readiness Serum ${suffix}`,
    );
    await page
      .getByLabel("Web address (slug)")
      .fill(`readiness-serum-${suffix}`);
    await page
      .getByLabel("Brand", { exact: true })
      .fill("Synthetic test fixture");
    await page
      .getByLabel("Verified description")
      .fill("Reviewed packaging for an isolated test fixture.");
    await page.getByLabel("SKU", { exact: true }).fill(`R-${suffix}-A`);
    await page.getByLabel("Price (RWF)", { exact: true }).fill("1000");
    await page
      .getByRole("button", { name: "Add variant", exact: true })
      .click();
    await page.getByLabel("SKU", { exact: true }).nth(1).fill(`R-${suffix}-B`);
    await page.getByLabel("Price (RWF)", { exact: true }).nth(1).fill("1500");
    const photo = await sharp({
      create: { width: 400, height: 400, channels: 3, background: "#ddaabb" },
    })
      .png()
      .toBuffer();
    await page.getByLabel("Choose a photo").setInputFiles({
      name: "test-only-photo.png",
      mimeType: "image/png",
      buffer: photo,
    });
    await page
      .getByRole("button", { name: "Upload photo", exact: true })
      .click();
    await expect(page.getByLabel("Describe the photo")).toBeFocused();
    await page
      .getByLabel("Describe the photo")
      .fill("Isolated test photograph, not launch photography");
    await page
      .getByRole("button", { name: "Upload photo", exact: true })
      .click();
    await expect(page.getByLabel("Photo 1 description")).toHaveValue(
      "Isolated test photograph, not launch photography",
    );
    await page.getByLabel("I reviewed this content").check();
    await page.getByLabel("BeautyBOX has the right").check();
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page).toHaveURL(/\/staff\/catalog\/[0-9a-f-]{36}$/);
    await page.goto("/staff/stock/import");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV template" }).click();
    expect((await downloadPromise).suggestedFilename()).toBe(
      "stock-import-template.csv",
    );
    const header = STOCK_CSV_HEADER.join(",");
    await page
      .getByLabel("CSV rows", { exact: true })
      .fill(`${header}\nBAD,1,,`);
    await page
      .getByRole("button", { name: "Preview import", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("Row 2");
    await expect(page.getByLabel("CSV rows", { exact: true })).toBeFocused();
    const batch = `COUNT-${suffix}, signed`;
    const csv = `\uFEFF${header}\r\nR-${suffix}-A,7,OWNED,,,"${batch}",2028-02-29,500\r\n`;
    await page.getByLabel("Upload CSV", { exact: true }).setInputFiles({
      name: "count.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page
      .getByRole("button", { name: "Preview import", exact: true })
      .click();
    await expect(
      page.getByText("READY: 1 of 1 rows valid", { exact: true }),
    ).toBeVisible();
    // Editing source invalidates a server preview.
    await page.getByLabel("CSV rows", { exact: true }).fill(csv + "\n");
    await expect(
      page.getByText("READY: 1 of 1 rows valid", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Preview import", exact: true })
      .click();
    await expect(
      page.getByText("READY: 1 of 1 rows valid", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Reason / count reference")
      .fill("Signed isolated count");
    const requests: { body: string | null; key: string | undefined }[] = [];
    await page.route(
      "**/api/v1/staff/inventory/import-previews/*/apply",
      async (route) => {
        requests.push({
          body: route.request().postData(),
          key: route.request().headers()["idempotency-key"],
        });
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        if (requests.length === 1) await route.abort("failed");
        else await route.fulfill({ response });
      },
    );
    await page
      .getByRole("button", { name: "Apply import", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Check import outcome", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("CSV rows", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Reason / count reference")).toBeDisabled();
    await page
      .getByRole("button", { name: "Check import outcome", exact: true })
      .click();
    await expect(
      page.getByText("APPLIED: 1 of 1 rows valid", { exact: true }),
    ).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    const lots = await ownerQuery(
      "SELECT quantity_on_hand FROM commerce.inventory_lots WHERE batch_reference=$1",
      [batch],
    );
    expect(lots.rows).toEqual([{ quantity_on_hand: 7 }]);
    await expectNoHorizontalScroll(page);
  });

  test(`order dialog and support refund recovery retain exact requests at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await addSimpleToCart(page, "pure-zen-cleanser");
    await checkoutToPayment(page);
    await pay(page, "+250788123000");
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/, {
      timeout: 90000,
    });
    const id = page.url().split("/").at(-1)!;
    const ops = await staffMember("OPERATIONS");
    await context.setExtraHTTPHeaders({ "x-test-staff": ops });
    await page.goto(`/staff/orders/${id}`);
    await page
      .getByRole("button", { name: "Start preparation", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason", { exact: true }).fill("");
    await dialog
      .getByRole("button", { name: "Start preparation", exact: true })
      .click();
    await expect(dialog.getByLabel("Reason", { exact: true })).toBeFocused();
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Packed from a phone");
    const requests: { body: string | null; key: string | undefined }[] = [];
    await page.route(`**/api/v1/staff/orders/${id}/commands`, async (route) => {
      requests.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      if (requests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await dialog
      .getByRole("button", { name: "Start preparation", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Check action outcome" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Start preparation", exact: true })
      .click();
    await expect(dialog.getByLabel("Reason", { exact: true })).toHaveValue(
      "Packed from a phone",
    );
    await expect(dialog.getByLabel("Reason", { exact: true })).toBeDisabled();
    await expectNoHorizontalScroll(page);
    await dialog.getByRole("button", { name: "Check action outcome" }).click();
    await expect(dialog).toHaveCount(0);
    expect(requests[1]).toEqual(requests[0]);
    await page.unroute(`**/api/v1/staff/orders/${id}/commands`);
    // A stale version is refused and never turned into a fresh intent automatically.
    await page
      .getByRole("button", { name: "Assign rider", exact: true })
      .click();
    await dialog.getByLabel("Reason", { exact: true }).fill("Rider arranged");
    await dialog
      .getByLabel("Rider reference", { exact: true })
      .fill("TEST-RIDER");
    await ownerQuery(
      "UPDATE commerce.orders SET version=version+1 WHERE id=$1",
      [id],
    );
    await dialog
      .getByRole("button", { name: "Assign rider", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Reload the record" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Assign rider", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Reload the record" }).click();
    await context.setExtraHTTPHeaders({
      "x-test-staff": await staffMember("SUPPORT"),
    });
    await page.reload();
    await page
      .getByRole("button", {
        name: /^Request refund from the payment verified/,
      })
      .click();
    await dialog.getByLabel("Amount (RWF)").fill("1000");
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Customer asks for finance review");
    const refunds: { body: string | null; key: string | undefined }[] = [];
    await page.route("**/api/v1/staff/refunds", async (route) => {
      refunds.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      if (refunds.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await dialog
      .getByRole("button", { name: "Record request", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Check action outcome" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", {
        name: /^Request refund from the payment verified/,
      })
      .click();
    await expect(dialog.getByLabel("Amount (RWF)")).toHaveValue("1000");
    await expectNoHorizontalScroll(page);
    await dialog.getByRole("button", { name: "Check action outcome" }).click();
    await expect(dialog).toHaveCount(0);
    expect(refunds[1]).toEqual(refunds[0]);
    expect(
      (
        await ownerQuery(
          "SELECT count(*)::int AS n FROM commerce.refunds WHERE order_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      page.getByRole("button", { name: /^Approve refund/ }),
    ).toHaveCount(0);
    await context.setExtraHTTPHeaders({
      "x-test-staff": await staffMember("FINANCE"),
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Approve refund of RWF 1,000", exact: true })
      .click();
    await expectNoHorizontalScroll(page);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  });
}

test("route read recovery preserves the cart and accessible outer navigation", async ({
  page,
  context,
}) => {
  await addSimpleToCart(page, "pure-zen-cleanser");
  await page.goto("/dev/feedback?fail=1&delay=1000", { waitUntil: "commit" });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Loading BeautyBOX" })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "We couldn’t load this page" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "We couldn’t load this page" }),
  ).toBeFocused();
  await expect(page.getByRole("link", { name: /Cart.*1/ })).toBeVisible();
  await context.addCookies([
    {
      name: "bb-test-read-recovered",
      value: "1",
      url: "http://localhost:3100",
    },
  ]);
  await page.getByRole("button", { name: "Try loading again" }).click();
  await expect(
    page.getByRole("heading", { name: "Shop read recovered" }),
  ).toBeVisible();
  await page.goto("/cart");
  await expect(
    page
      .getByRole("list", { name: "Your cart", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(1);
});

test("staff recovery keeps navigation and TEST probe still requires staff authentication", async ({
  page,
  context,
}) => {
  await page.goto("/staff/feedback-preview?fail=1");
  await expect(page).toHaveURL(/\/staff\/sign-in/);
  await context.setExtraHTTPHeaders({
    "x-test-staff": await staffMember("OPERATIONS"),
  });
  await page.goto("/staff/feedback-preview?fail=1&delay=1000", {
    waitUntil: "commit",
  });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Loading workspace" })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "We couldn’t load this page" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Orders", exact: true }),
  ).toBeVisible();
  await context.addCookies([
    {
      name: "bb-test-read-recovered",
      value: "1",
      url: "http://localhost:3100",
    },
  ]);
  await page.getByRole("button", { name: "Try loading again" }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace read recovered" }),
  ).toBeVisible();
});

test("unauthorized roles cannot reach import controls", async ({
  page,
  context,
}) => {
  for (const role of ["SUPPORT", "FINANCE"] as const) {
    await context.setExtraHTTPHeaders({
      "x-test-staff": await staffMember(role),
    });
    await page.goto("/staff/stock/import");
    await expect(
      page.getByText("Your role does not include stock imports.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Preview import" }),
    ).toHaveCount(0);
  }
});
