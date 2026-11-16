import { expect, test } from "./fixtures";
import { addSimpleToCart } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });
async function startDelivery(page: import("@playwright/test").Page) {
  await addSimpleToCart(page, "makeup-bag");
  await page.goto("/cart");
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await page.getByLabel("Recipient name").fill("Demo Recipient");
  await page.getByLabel("Delivery phone").fill("0788 555 111");
  await page.getByRole("button", { name: "Continue to delivery" }).click();
  const heading = page.getByRole("heading", {
    name: "Where should we deliver?",
  });
  await expect(heading).toBeFocused();
  const [titleBox, headerBox] = await Promise.all([
    heading.boundingBox(),
    page.locator("header").boundingBox(),
  ]);
  expect(titleBox!.y).toBeGreaterThanOrEqual(
    headerBox!.y + headerBox!.height - 1,
  );
}
async function selectFixture(
  page: import("@playwright/test").Page,
  label: string,
) {
  await page.getByLabel(/Search for a place/).fill(label);
  await page
    .getByRole("button", {
      name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    })
    .click();
  await page.getByRole("button", { name: "Confirm pin and get fee" }).click();
}

test("Kigali starting prices are recalculated and reviewed after a location change", async ({
  page,
}) => {
  await startDelivery(page);
  await selectFixture(page, "Fixture: 5.0 km");
  await expect(
    page.getByRole("heading", { name: "Review delivery" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Order summary" }),
  ).toContainText("RWF 2,000");
  await page
    .getByRole("button", { name: "Change location", exact: true })
    .click();
  await selectFixture(page, "Fixture: 3.1 km");
  await expect(
    page.getByRole("heading", { name: "Review delivery" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Order summary" }),
  ).toContainText("RWF 1,600");
  await page.getByRole("button", { name: "Accept fee and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Review and pay" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay RWF 11,600" }),
  ).toBeVisible();
});

for (const [label, message] of [
  [
    "Fixture: route service unavailable",
    "We couldn't calculate delivery right now. Your basket is saved. Please try again.",
  ],
  ["Fixture: no motorcycle route", "Outside our delivery area"],
]) {
  test(`an unavailable delivery retains the cart and blocks payment: ${label}`, async ({
    page,
  }) => {
    await startDelivery(page);
    await selectFixture(page, label!);
    await expect(page.getByText(message!, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Pay RWF/ })).toHaveCount(0);
    await page.goto("/cart");
    await expect(
      page.getByRole("list", { name: "Your cart", exact: true }),
    ).toContainText("Makeup Bag");
  });
}

test("a slow Places response cannot replace a later pin adjustment", async ({
  page,
}) => {
  await startDelivery(page);
  await page.getByLabel(/Search for a place/).fill("Fixture: 5.0 km");
  await page.getByRole("button", { name: /Fixture: 5\.0 km/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Pin set to" }),
  ).toBeVisible();
  let release: () => void = () => {};
  let received: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/places/demo-kcc", async (route) => {
    received();
    await responseGate;
    await route.fulfill({
      json: {
        label: "Late place result",
        point: { lat: -1.954442, lng: 30.093295 },
      },
    });
  });
  await page.getByLabel(/Search for a place/).fill("Kigali Convention Centre");
  await page.getByRole("button", { name: /Kigali Convention Centre/ }).click();
  await arrived;
  await page.getByRole("button", { name: "Move pin north" }).click();
  const lateResponse = page.waitForResponse("**/api/v1/places/demo-kcc");
  release();
  await lateResponse;
  // This assertion polls the committed server pin, after the delayed browser response.
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      /\/checkouts\/[^/]+$/.test(new URL(request.url()).pathname),
  );
  await page.getByRole("button", { name: "Confirm pin and get fee" }).click();
  expect((await saved).postDataJSON().destination).toEqual({
    lat: -1.951775,
    lng: 30.072,
  });
});
