import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { addShadeToCart, expectNoHorizontalScroll } from "./helpers";

test.use({ viewport: { width: 360, height: 800 } });

test("closing the shade sheet discards draft choices; confirmation enables adding", async ({
  page,
}) => {
  await page.goto("/products/lip-hue");
  const add = page.getByRole("button", { name: "Add to cart", exact: true });
  await expect(add).toBeDisabled();
  await page
    .getByRole("button", { name: "Choose your shade", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Choose a shade" });
  await dialog.getByRole("radio", { name: "Brownie", exact: true }).check();
  await dialog.getByRole("button", { name: "Close options" }).click();
  await expect(add).toBeDisabled();
  await page
    .getByRole("button", { name: "Choose your shade", exact: true })
    .click();
  await expect(
    dialog.getByRole("radio", { name: "Brownie", exact: true }),
  ).not.toBeChecked();
  await dialog.getByRole("radio", { name: "Rosy", exact: true }).check();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole("button", { name: "Use Rosy", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Change shade", exact: true }),
  ).toBeFocused();
  await expect(add).toBeEnabled();
  await expect(page.getByText("Selected shade: Rosy")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("changing a cart shade merges the target once and keeps the server total", async ({
  page,
}) => {
  await addShadeToCart(page, "lip-hue", "Brownie", 2);
  await addShadeToCart(page, "lip-hue", "Salmon", 1);
  await page.goto("/cart");
  const list = page.getByRole("list", { name: "Your cart", exact: true });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  const source = list
    .getByRole("listitem")
    .filter({ hasText: "Shade: Brownie" });
  await source
    .getByRole("button", { name: "Change shade", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Choose a shade" });
  await dialog.getByRole("radio", { name: "Salmon", exact: true }).check();
  await dialog.getByRole("button", { name: "Use Salmon", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("Shade: Salmon");
  await expect(list).not.toContainText("Shade: Brownie");
  await expect(
    page.getByRole("complementary", { name: "Order summary" }),
  ).toContainText("RWF 36,000");
  await expect(page.locator("#cart-heading")).toBeFocused();
  await expect
    .poll(() =>
      list
        .locator("img")
        .first()
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expectNoHorizontalScroll(page);
});
