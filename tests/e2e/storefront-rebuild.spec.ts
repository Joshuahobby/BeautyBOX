import { expect, test } from "./fixtures";
import { addSimpleToCart, expectNoHorizontalScroll } from "./helpers";

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

test("mobile menu keeps one usable search and closes when the shop query changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/shop?category=makeup");
  const trigger = page.getByRole("button", {
    name: "Shop categories",
    exact: true,
  });
  await trigger.click();
  const search = page.getByRole("searchbox", {
    name: "Search products",
    exact: true,
  });
  await expect(search).toHaveCount(1);
  await search.fill("lip");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/shop\?q=lip$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Results for “lip”",
  );
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(search).toHaveCount(1);
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

test("hero copy stays clear of campaign art and search stays usable across tablet breakpoints", async ({
  page,
}) => {
  for (const width of [651, 768, 900, 1003, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const search = page.getByRole("searchbox", {
      name: "Search products",
      exact: true,
    });
    expect((await search.boundingBox())!.width).toBeGreaterThanOrEqual(240);
    const hero = page.getByRole("region", {
      name: "BeautyBOX featured collections",
    });

    for (const slide of [1, 2, 3]) {
      await hero
        .getByRole("button", { name: "Show feature " + slide, exact: true })
        .click();
      const art = (await hero.locator("img").first().boundingBox())!;
      const body = (await hero.locator("h1 + p").boundingBox())!;
      const action = (await hero.getByRole("link").boundingBox())!;
      const intro = (await hero
        .getByText("From our shop in Kigali", { exact: true })
        .boundingBox())!;
      const highlight = (await hero.locator("h1 span").first().boundingBox())!;
      expect(
        intro.y + intro.height,
        `intro at ${width}px / slide ${slide}`,
      ).toBeLessThanOrEqual(highlight.y);
      const spans = await hero
        .locator("h1 span")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getBoundingClientRect().right),
        );
      expect(
        body.x + body.width,
        `body at ${width}px / slide ${slide}`,
      ).toBeLessThanOrEqual(art.x);
      expect(
        action.x + action.width,
        `CTA at ${width}px / slide ${slide}`,
      ).toBeLessThanOrEqual(art.x);
      expect(
        Math.max(...spans),
        `headline at ${width}px / slide ${slide}`,
      ).toBeLessThanOrEqual(art.x);
      await expectNoHorizontalScroll(page);
    }
  }
});

test("a special-delivery basket explains the block and recovers when the item is removed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await addSimpleToCart(page, "pure-zen-cleanser");
  await addSimpleToCart(page, "salon-hood-dryer");
  await page.goto("/cart");
  await expect(
    page.getByText(/This item needs special delivery/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resolve cart to continue" }),
  ).toBeDisabled();
  const removal = page.getByRole("button", {
    name: "Remove Salon Hood Dryer (special delivery)",
    exact: true,
  });
  const removeBox = (await removal.boundingBox())!;
  const summaryBox = (await page
    .getByRole("complementary", { name: "Order summary" })
    .boundingBox())!;
  expect(summaryBox.y).toBeGreaterThanOrEqual(removeBox.y + removeBox.height);
  await page
    .getByRole("button", {
      name: "Remove Salon Hood Dryer (special delivery)",
      exact: true,
    })
    .click();
  await expect(page.getByText(/This item needs special delivery/)).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Continue to checkout" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await expect(
    page.getByRole("heading", { name: "Who is receiving?" }),
  ).toBeVisible();
});
