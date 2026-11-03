import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { addShadeToCart, expectNoHorizontalScroll } from "./helpers";

// T21: 360 / 768 / 1440 px layouts, 320 px reflow (~1280 px at 400% / 360 px at 200%),
// keyboard operation, reduced motion and automated WCAG 2.2 AA checks.

const WIDTHS = [360, 768, 1440] as const;
const SCREENS = "test-results/screens";

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
  expect(summary, "axe violations").toEqual([]);
}

for (const width of WIDTHS) {
  test(`pre-launch pages fit and pass axe at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // The settled pages: no half-faded text for axe, no half-built stage in the screenshots.
    // The animated opening is checked in its own test below.
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const [name, path, heading] of [
      ["launching-soon", "/launching-soon", "Everyday beauty essentials, coming soon."],
      ["preview-access", "/access", "Preview access"],
      ["launch-privacy", "/launch-privacy", "Launch list privacy notice"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `${SCREENS}/${name}-${width}.png`, fullPage: true });
      await axe(page);
    }
  });

  test(`storefront pages fit and pass axe at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path] of [
      ["home", "/"],
      ["shop", "/shop"],
      ["product-variant", "/products/eternal-matteblend-foundation"],
      ["product-unavailable", "/products/ember-perfume"],
      ["help", "/help"],
    ] as const) {
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `${SCREENS}/${name}-${width}.png`, fullPage: true });
      await axe(page);
    }
  });

  test(`cart and checkout fit and pass axe at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await addShadeToCart(page, "lip-hue", "Salmon");
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${SCREENS}/cart-${width}.png`, fullPage: true });
    await axe(page);
    await page.getByRole("button", { name: "Continue to checkout" }).click();
    await expect(page.getByRole("heading", { name: "Who is receiving?" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${SCREENS}/checkout-contact-${width}.png`, fullPage: true });
    await axe(page);
    // Invalid submit: error summary takes focus and links to the fields.
    await page.getByRole("button", { name: "Continue to delivery" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Check the highlighted details" })).toBeFocused();
    await axe(page);
    await page.getByLabel("Recipient name").fill("Demo Recipient");
    await page.getByLabel("Delivery phone").fill("0788 555 111");
    await page.getByRole("button", { name: "Continue to delivery" }).click();
    await page.getByLabel(/Search for a place/).fill("Kicukiro");
    await page.getByRole("button", { name: /Kicukiro Centre/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Pin set to" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${SCREENS}/checkout-delivery-${width}.png`, fullPage: true });
    await axe(page);
    await page.getByRole("button", { name: "Confirm pin and get fee" }).click();
    await page.getByRole("button", { name: "Accept fee and continue" }).click();
    await expect(page.getByRole("heading", { name: "Review and pay" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${SCREENS}/checkout-pay-${width}.png`, fullPage: true });
    await axe(page);
  });
}

test("checkout reflows at 320 CSS px without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await addShadeToCart(page, "lip-hue", "Vermillion");
  await page.goto("/cart");
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await expect(page.getByRole("heading", { name: "Who is receiving?" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("shade selection and add to cart work with the keyboard alone", async ({ page }) => {
  await page.goto("/products/lip-hue");
  const first = page.getByRole("radio", { name: "Brownie", exact: true });
  await first.focus();
  await page.keyboard.press("ArrowRight"); // native radio group: moves to the next available shade
  const checked = page.getByRole("radio", { checked: true });
  await expect(checked).toHaveCount(1);
  // Tab forward (the disabled decrease button is skipped) until the add button has focus.
  let focused = "";
  for (let i = 0; i < 6 && !focused.includes("Add to cart"); i++) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
  }
  expect(focused).toContain("Add to cart");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle);
  expect(outline).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Added to cart", { exact: true })).toBeVisible();
});

test("mobile filter sheet keeps applied filters until Apply and returns focus", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/shop");
  const trigger = page.getByRole("button", { name: "Filters", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Filters" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Category").selectOption("makeup");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/\/shop$/); // closing discarded the draft
  await trigger.click();
  await dialog.getByLabel("Category").selectOption("makeup");
  await dialog.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/category=makeup/);
  await expect(page.getByRole("heading", { name: "Makeup", level: 1 })).toBeVisible();
});

test("the launch page opening settles into a page that passes axe", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/launching-soon");
  // Every one-off animation has finished; only the looping dot and rings keep going.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === "finished" || a.effect?.getComputedTiming().iterations === Infinity));
  await axe(page);
});

const FILM_FILE = /\/_next\/static\/media\/beautybox-promo\.[^./]+\.(webm|mp4)$/;
const POSTER_FILE = /\/_next\/static\/media\/poster\.[^./]+\.png$/;
const POSTER_SECONDS = 96 / 30;
// HTMLMediaElement readyState / networkState values (the test runner has no DOM).
const HAVE_NOTHING = 0;
const HAVE_FUTURE_DATA = 3;
const NETWORK_LOADING = 2;

const filmState = (page: Page) =>
  page
    .locator("figure video")
    .evaluate((v: HTMLVideoElement) => ({ playing: !v.paused, muted: v.muted, time: v.currentTime, loaded: v.readyState, network: v.networkState, src: v.currentSrc, poster: v.poster }));

/**
 * The playback position once the film really plays (data loaded, "playing" fired): it starts on
 * the poster's frame, not at 0. currentTime alone would not do: before anything loads it reports
 * the requested start position.
 */
const firstPlayedSecond = (page: Page) =>
  page.locator("figure video").evaluate(
    (v: HTMLVideoElement, ready) =>
      !v.paused && v.readyState >= ready ? v.currentTime : new Promise<number>((done) => v.addEventListener("playing", () => done(v.currentTime), { once: true })),
    HAVE_FUTURE_DATA,
  );

test("the launch film plays muted from a hashed static file and pauses on request", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/launching-soon");
  expect(await firstPlayedSecond(page)).toBeGreaterThanOrEqual(POSTER_SECONDS);
  const playing = await filmState(page);
  expect(playing).toMatchObject({ playing: true, muted: true });
  // Served like images: hashed, and outside the access wall (which passes /_next/).
  expect(playing.src).toMatch(FILM_FILE);
  expect(playing.poster).toMatch(POSTER_FILE);
  // Evidence: the coral "delivered in Kigali" scene, mid-film.
  await page.locator("figure video").evaluate(
    (v: HTMLVideoElement) =>
      new Promise<void>((done) => {
        v.addEventListener("seeked", () => done(), { once: true });
        v.currentTime = 9.3;
      }),
  );
  await page.screenshot({ path: `${SCREENS}/launching-soon-film-1440.png` });
  await page.getByRole("button", { name: "Pause the film" }).click();
  await expect(page.getByRole("button", { name: "Play the film" })).toBeFocused();
  const paused = await filmState(page);
  expect(paused.playing).toBe(false);
  await page.waitForTimeout(600);
  expect((await filmState(page)).time).toBe(paused.time);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("transitions are disabled", async ({ page }) => {
    await page.goto("/");
    const duration = await page.evaluate(() => getComputedStyle(document.querySelector("a[href='/shop']")!).transitionDuration);
    expect(duration.split(",").every((d) => d.trim() === "0s")).toBe(true);
  });

  test("the launch page holds still", async ({ page }) => {
    await page.goto("/launching-soon");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  test("the launch film shows its poster and loads nothing until Play", async ({ page }) => {
    const filmRequests: string[] = [];
    page.on("request", (request) => {
      if (FILM_FILE.test(new URL(request.url()).pathname)) filmRequests.push(request.url());
    });
    const poster = page.waitForResponse((response) => POSTER_FILE.test(new URL(response.url()).pathname));
    await page.goto("/launching-soon");
    expect((await poster).status()).toBe(200);
    const play = page.getByRole("button", { name: "Play the film" });
    await expect(play).toBeVisible();
    await page.waitForTimeout(800);
    const still = await filmState(page);
    expect(still).toMatchObject({ playing: false, loaded: HAVE_NOTHING });
    expect(still.network).not.toBe(NETWORK_LOADING);
    expect(filmRequests).toEqual([]);
    const film = page.waitForResponse((response) => FILM_FILE.test(new URL(response.url()).pathname));
    await play.click();
    expect([200, 206]).toContain((await film).status());
    expect(await firstPlayedSecond(page)).toBeGreaterThanOrEqual(POSTER_SECONDS);
    await expect(page.getByRole("button", { name: "Pause the film" })).toBeVisible();
  });
});
