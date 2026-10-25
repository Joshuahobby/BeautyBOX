import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

// Self-service staff password reset pages (DR-040). The test environment has no Supabase
// project, so these cover what the browser controls: the entry link, the request form's
// validation, how a failed reset link is explained, that the link's parameters do not stay
// in the address bar, and accessibility. The CSP guard applies to every page here too.

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("sign-in offers a password reset that asks for the staff email", async ({ page }) => {
  await page.goto("/staff/sign-in");
  await page.getByRole("link", { name: "Forgotten your password?" }).click();
  await expect(page).toHaveURL(/\/staff\/forgot-password$/);
  await expect(page.getByRole("heading", { name: "Reset your password", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter the email address of your staff account." })).toBeVisible();

  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(/\/staff\/sign-in$/);
});

test("an expired reset link is explained, offers a new one and leaves nothing in the address bar", async ({ page }) => {
  await page.goto("/staff/reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  await expect(page.getByRole("heading", { name: "Choose a new password", level: 1 })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "This reset link has expired or was already used." })).toBeVisible();
  await expect(page).toHaveURL(/\/staff\/reset-password$/);
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: "Request a new link" }).click();
  await expect(page).toHaveURL(/\/staff\/forgot-password$/);
});

test("the reset page without a link never offers a password form", async ({ page }) => {
  // Without a one-time code from the email this page must not fall back to a session
  // already signed in on this browser (security review, DR-040).
  await page.goto("/staff/reset-password");
  await expect(page.getByRole("alert").filter({ hasText: "This page opens from the link in a password reset email." })).toBeVisible();
  await expect(page.getByLabel("New password")).toHaveCount(0);
});

test("a reset link carried in the fragment is read the same way", async ({ page }) => {
  await page.goto("/staff/reset-password#error=access_denied&error_code=otp_expired");
  await expect(page.getByRole("alert").filter({ hasText: "This reset link has expired or was already used." })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
});
