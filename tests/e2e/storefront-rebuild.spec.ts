import { expect, test } from "./fixtures";
import { expectNoHorizontalScroll } from "./helpers";

test("feature carousel changes the collection and CTA without automatic movement", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "for every day.",
  );
  await page.getByRole("button", { name: "Next feature", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "all your own.",
  );
  await expect(
    page.getByRole("link", { name: "Explore makeup", exact: true }),
  ).toHaveAttribute("href", "/shop?category=makeup");
  await page
    .getByRole("button", { name: "Previous feature", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "for every day.",
  );
  await page
    .getByRole("button", { name: "Show feature 3", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Show feature 3", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("link", { name: "Find your skincare", exact: true }),
  ).toHaveAttribute("href", "/shop?category=skincare");
});

test("department mega menu supports keyboard dismissal and real category navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const trigger = page
    .getByRole("navigation", { name: "Shop departments" })
    .getByRole("button", { name: "Skincare", exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("link", { name: "Cleansers", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page.getByRole("link", { name: "Cleansers", exact: true }).click();
  await expect(page).toHaveURL(/category=cleansers/);
  await expect(
    page.getByRole("heading", { name: "Cleansers", level: 1 }),
  ).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("mobile category menu closes even when only the shop query changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/shop?category=makeup");
  const trigger = page.getByRole("button", {
    name: "Shop categories",
    exact: true,
  });
  await trigger.click();
  await page
    .getByRole("navigation", { name: "Categories", exact: true })
    .getByRole("link", { name: "Skincare", exact: true })
    .click();
  await expect(page).toHaveURL(/category=skincare/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Skincare");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expectNoHorizontalScroll(page);
});

test("brand discovery stays selected when price filters are applied", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/shop?brand=Sample%20Labs");
  const filters = page.getByRole("complementary", {
    name: "Filters",
    exact: true,
  });
  await filters.getByLabel("Maximum", { exact: false }).fill("10000");
  await filters
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page).toHaveURL(/brand=Sample\+Labs/);
  await expect(page).toHaveURL(/maxPriceRwf=10000/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Sample Labs",
  );
});

test("homepage budget discovery uses the real catalog price filter", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("link", { name: "Explore the finds", exact: true })
    .click();
  await expect(page).toHaveURL(/maxPriceRwf=10000/);
  const cards = page
    .getByRole("list", { name: "Products", exact: true })
    .getByRole("article");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);
});

test("campaign artwork and the four featured demo product images load", async ({
  page,
}) => {
  for (const width of [360, 1003]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const edit = page.getByRole("list", {
      name: "The everyday edit",
      exact: true,
    });
    await expect(edit.locator("img")).toHaveCount(4);
    await edit.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        edit
          .locator("img")
          .evaluateAll((images) =>
            images.every(
              (image) => (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page
          .getByRole("img", { name: /emerald jar/ })
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await expectNoHorizontalScroll(page);
  }
});
