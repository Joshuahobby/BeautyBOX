import { expect, test } from "./fixtures";
import {
  addShadeToCart,
  addSimpleToCart,
  checkoutToPayment,
  expectNoHorizontalScroll,
  pay,
} from "./helpers";

test.use({ viewport: { width: 360, height: 780 } });

test("guest buys a shade variant and simple item, sees verified payment and a private order", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Beauty,.*for every day/ }),
  ).toBeVisible();

  await addShadeToCart(page, "lip-hue", "Brownie", 2);
  await addSimpleToCart(page, "pure-zen-cleanser");
  await page.goto("/cart");
  await expect(page.getByText("Shade: Brownie")).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Order summary" }),
  ).toContainText("RWF 39,000");

  await checkoutToPayment(page);
  await expectNoHorizontalScroll(page);
  const payButton = page.getByRole("button", { name: /^Pay RWF/ });
  const label = (await payButton.textContent()) ?? "";
  expect(label).toMatch(/^Pay RWF [\d,]+$/);
  await expect(
    page.getByText("Never share your mobile-money PIN"),
  ).toBeVisible();

  await pay(page, "+250788123000");
  await expect(
    page.getByRole("heading", { name: "Approve on your phone" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Do not start another payment while this one is being checked.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pay RWF/ })).toHaveCount(0);

  // Confirmation comes only from the verified server result.
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 90_000 });
  await expect(
    page.getByRole("heading", { name: "Your order is confirmed" }),
  ).toBeVisible();
  await expect(
    page.getByText("Payment confirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(label.replace("Pay ", ""), { exact: false }).first(),
  ).toBeVisible();
  const orderUrl = page.url();

  // The cart is fresh after purchase.
  await page.goto("/cart");
  await expect(page.getByText("Your cart is empty.")).toBeVisible();

  // T15: a different browser that guesses the URL learns nothing.
  const stranger = await browser.newContext();
  const other = await stranger.newPage();
  await other.goto(orderUrl);
  await expect(
    other.getByRole("heading", { name: "This order link is unavailable" }),
  ).toBeVisible();
  await expect(other.getByText("Demo Recipient")).toHaveCount(0);
  await stranger.close();
});

test("a verified failure releases the way to a fresh review, never an automatic retry", async ({
  page,
}) => {
  await addSimpleToCart(page, "mascara-twinkle-lengthen");
  await checkoutToPayment(page, "Nyabugogo");
  await pay(page, "+250788123001");
  await expect(
    page.getByRole("heading", { name: "Payment not completed" }),
  ).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: "Review and try again" }).click();
  await expect(
    page.getByText(
      "We will recheck stock, delivery fee and the final total before a new attempt.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Where should we deliver?" }),
  ).toBeVisible();
});

test("variant choice is required and unavailable shades cannot be chosen", async ({
  page,
}) => {
  await page.goto("/products/lip-hue");
  await expect(
    page.getByRole("button", { name: "Add to cart", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Choose a shade before adding this item."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Choose your shade", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "Royal, unavailable" }),
  ).toBeDisabled();
});

test("an out-of-stock product cannot be added and points back to its category", async ({
  page,
}) => {
  await page.goto("/products/ember-perfume");
  await expect(
    page.getByText("This item cannot be added to your cart right now."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add to cart", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Browse Fragrance" }),
  ).toBeVisible();
});

test("asking for more than the available stock is explained, never silently trimmed", async ({
  page,
}) => {
  await page.goto("/products/lip-hue");
  await page
    .getByRole("button", { name: "Choose your shade", exact: true })
    .click();
  await page.getByRole("radio", { name: "Rosy", exact: true }).check(); // 1 in stock
  await page.getByRole("button", { name: "Use Rosy", exact: true }).click();
  await page.getByRole("textbox", { name: "Quantity", exact: true }).fill("3");
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "available quantity changed" }),
  ).toContainText("Only 1 can be added right now");
});

test("an unsupported destination blocks payment with a clear recovery path", async ({
  page,
}) => {
  await addSimpleToCart(page, "makeup-bag");
  await page.goto("/cart");
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await page.getByLabel("Recipient name").fill("Demo Recipient");
  await page.getByLabel("Delivery phone").fill("0788 555 111");
  await page.getByLabel("E-mail address").fill("buyer@example.com");
  await page.getByRole("button", { name: "Continue to delivery" }).click();
  await page.getByLabel(/Search for a place/).fill("Musanze");
  await page.getByRole("button", { name: /Musanze/ }).click();
  await page.getByRole("button", { name: "Confirm pin and get fee" }).click();
  await expect(page.getByText("Outside our delivery area")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pay RWF/ })).toHaveCount(0);
});

test("private order pages give the same answer for unknown and malformed ids", async ({
  page,
}) => {
  await page.goto("/orders/00000000-0000-4000-8000-000000000000");
  await expect(
    page.getByRole("heading", { name: "This order link is unavailable" }),
  ).toBeVisible();
  await page.goto("/orders/not-a-uuid");
  await expect(
    page.getByRole("heading", { name: "This order link is unavailable" }),
  ).toBeVisible();
});
