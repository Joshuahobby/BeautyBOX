import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { expectNoHorizontalScroll } from "./helpers";

for (const width of [360, 768, 1440]) {
  test(`shop information and complete draft policies are usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, heading] of [
      ["/about", "About BeautyBOX"],
      ["/help", "Help"],
      ["/help/delivery-returns", "Delivery & returns"],
      ["/help/terms", "Terms"],
      ["/help/privacy", "Privacy"],
    ]) {
      await page.goto(path!);
      await expect(
        page.getByRole("heading", { level: 1, name: heading!, exact: true }),
      ).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expect(page.locator("main")).not.toContainText(
        /\[[A-Z][A-Z _/-]{3,}\]/,
      );
      if (path!.startsWith("/help/")) {
        await expect(
          page.getByText(
            "Draft for review. This policy is not approved for publication.",
            { exact: true },
          ),
        ).toBeVisible();
      }
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        axe.violations.map((v) => ({ id: v.id, impact: v.impact })),
      ).toEqual([]);
    }
    await page.goto("/help");
    await page
      .getByRole("link", { name: "Payment or refund", exact: true })
      .click();
    await expect(page).toHaveURL(/#payment-help$/);
    await expect(
      page
        .locator("#payment-help")
        .getByRole("heading", { name: "Payment or refund", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Payments and refunds guide", exact: true })
      .click();
    await expect(page).toHaveURL(/\/help\/delivery-returns$/);
  });
}

test("the homepage story and footer lead to the actual BeautyBOX information", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Meet BeautyBOX", exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(
    page.getByText("Silverback Mall, Kicukiro, Kigali, Rwanda", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("contentinfo")
    .getByRole("link", { name: "Help", exact: true })
    .click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(
    page.getByText(
      "Support contact details are not yet confirmed. They will appear here before launch.",
      { exact: true },
    ),
  ).toBeVisible();
});
