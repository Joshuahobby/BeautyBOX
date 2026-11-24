import { expect, type Page } from "@playwright/test";

export async function addShadeToCart(
  page: Page,
  slug: string,
  shade: string,
  quantity = 1,
) {
  await page.goto(`/products/${slug}`);
  const add = page.getByRole("button", { name: "Add to cart", exact: true });
  await expect(add).toBeDisabled();
  await page
    .getByRole("button", { name: "Choose your shade", exact: true })
    .click();
  await page.getByRole("radio", { name: shade, exact: true }).check();
  await page.getByRole("button", { name: "Use " + shade, exact: true }).click();
  if (quantity !== 1)
    await page
      .getByRole("textbox", { name: "Quantity", exact: true })
      .fill(String(quantity));
  await add.click();
  await expect(page.getByText("Added to cart", { exact: true })).toBeVisible();
}

export async function addSimpleToCart(page: Page, slug: string) {
  await page.goto(`/products/${slug}`);
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(page.getByText("Added to cart", { exact: true })).toBeVisible();
}

export async function checkoutToPayment(page: Page, place = "Kimironko") {
  await page.goto("/cart");
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await expect(
    page.getByRole("heading", { name: "Who is receiving?" }),
  ).toBeVisible();
  await page.getByLabel("Recipient name").fill("Demo Recipient");
  await page.getByLabel("Delivery phone").fill("0788 555 111");
  await page.getByLabel("E-mail address").fill("buyer@example.com");
  await page.getByRole("button", { name: "Continue to delivery" }).click();
  await expect(
    page.getByRole("heading", { name: "Where should we deliver?" }),
  ).toBeVisible();
  await page.getByLabel(/Search for a place/).fill(place);
  await page
    .getByRole("button", { name: new RegExp(place) })
    .first()
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Pin set to" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm pin and get fee" }).click();
  await expect(
    page.getByRole("heading", { name: "Review delivery" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept fee and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Review and pay" }),
  ).toBeVisible();
}

export async function pay(page: Page, payerPhone: string) {
  await page.getByLabel("MTN MoMo").check();
  await page.getByLabel("Paying phone").fill(payerPhone);
  await page.getByRole("button", { name: /^Pay RWF/ }).click();
  await expect(page).toHaveURL(/\/payment\//);
}

/** Fails the test if the page scrolls horizontally (FSD 12: no horizontal checkout scroll at 360 px). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow in CSS px").toBeLessThanOrEqual(1);
}
