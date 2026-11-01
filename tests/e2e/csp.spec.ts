import { expect, test } from "./fixtures";

// Strict style CSP (DR-039). The fixture fails any test that triggers a violation; these
// tests also prove the policy is the strict one and that dialogs still lock scrolling.

// Seeded demo catalog (scripts/seed-demo.ts): a shade picker, a special-delivery item and an
// unavailable product. /checkout with an empty cart renders its loading shell, then moves
// to /cart; the full checkout runs under the guard in purchase.spec.ts.
const PUBLIC_PAGES = [
  "/",
  "/shop",
  "/shop?category=makeup",
  "/products/lip-hue",
  "/products/salon-hood-dryer",
  "/products/ember-perfume",
  "/help",
  "/cart",
  "/checkout",
  "/order-access",
  "/o",
  "/orders/00000000-0000-0000-0000-000000000000",
  "/payment/00000000-0000-0000-0000-000000000000",
  "/staff/sign-in",
  "/no-such-page",
];

function directive(csp: string, name: string): string {
  return (
    csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${name} `)) ?? ""
  );
}

test("production pages send a style policy without 'unsafe-inline', bound to the script nonce", async ({ request }) => {
  const response = await request.get("/");
  const csp = response.headers()["content-security-policy"] ?? "";
  const style = directive(csp, "style-src");
  const script = directive(csp, "script-src");
  expect(style).not.toContain("'unsafe-inline'");
  const nonce = /'nonce-([^']+)'/.exec(style)?.[1];
  expect(nonce, "style-src carries a nonce").toBeTruthy();
  expect(script).toContain(`'nonce-${nonce}'`);
  expect(csp).not.toMatch(/style-src-attr|style-src-elem/); // one rule, no exceptions

  const again = (await request.get("/")).headers()["content-security-policy"] ?? "";
  expect(/'nonce-([^']+)'/.exec(directive(again, "style-src"))?.[1], "a fresh nonce per response").not.toBe(nonce);

  // /api skips the proxy; an unknown path there still renders HTML, under a deny-all policy.
  const api = await request.get("/api/no-such-endpoint");
  expect(api.headers()["content-security-policy"] ?? "").toContain("default-src 'none'");
});

test("server-rendered pages contain no inline style attributes and render without violations", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  const open = new Set<string>();
  page.on("request", (r) => open.add(r.url()));
  page.on("requestfinished", (r) => open.delete(r.url()));
  page.on("requestfailed", (r) => open.delete(r.url()));

  for (const path of PUBLIC_PAGES) {
    const html = await (await request.get(path)).text();
    expect(html.match(/<[a-z][^>]*\sstyle="[^"]*"/gi) ?? [], `inline style attributes in ${path}`).toEqual([]);
    expect(html.match(/<style(?![^>]*\snonce=)[^>]*>/gi) ?? [], `<style> elements without a nonce in ${path}`).toEqual([]);
    // Shop pages render inside <main id="main">; the staff sign-in and root 404 pages have an h1.
    await page.goto(path);
    await expect(page.locator("#main, h1").first()).toBeVisible();
    // Give hydration and client effects a moment so late violations are caught too. A page
    // that keeps the network busy is recorded for diagnosis rather than failing the sweep.
    const settled = await page.waitForLoadState("networkidle", { timeout: 5_000 }).then(
      () => true,
      () => false,
    );
    if (!settled) {
      const note = `${path}: ${[...open].slice(0, 5).join(", ")}`;
      testInfo.annotations.push({ type: "network still busy", description: note });
      console.log(`[csp sweep] network still busy on ${note}`);
    }
  }
});

test("a dialog's scroll lock is applied under the strict policy", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/shop");
  const overflowBefore = await page.evaluate(() => getComputedStyle(document.body).overflow);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
  // react-remove-scroll injects a <style> element; it only applies if it carries the nonce.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
  expect(overflowBefore).not.toBe("hidden");
  const nonced = await page.evaluate(() => [...document.querySelectorAll("head style")].filter((s) => (s as HTMLStyleElement).nonce).length);
  expect(nonced).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).toBe(overflowBefore);
});
