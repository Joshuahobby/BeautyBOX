import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Browser, type Page } from "./fixtures";
import pg from "pg";
import sharp from "sharp";
import { addSimpleToCart, checkoutToPayment, pay } from "./helpers";

// I09-I11 in a real browser against the production build: private order links from the
// simulated SMS inbox (T15), a customer cancellation request decided by staff, and staff
// fulfilment through guarded dialogs. Staff identity uses the TEST provider header,
// which the server accepts only when APP_ENV=test.

const env: Record<string, string> = {};
for (const line of fs.readFileSync(path.resolve(import.meta.dirname, "..", "..", ".env.test"), "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i)] = line.slice(i + 1);
}

async function runJobs(request: APIRequestContext) {
  for (let i = 0; i < 3; i++) {
    const res = await request.post("/api/v1/internal/jobs/run", {
      headers: { authorization: `Bearer ${env.WORKER_SECRET}` },
      data: { batchSize: 50, maxRuntimeSeconds: 20 },
    });
    expect(res.ok()).toBeTruthy();
  }
}

async function staffMember(role: "OPERATIONS" | "SUPPORT" | "FINANCE" | "ADMIN", name = `E2E ${role}`): Promise<string> {
  const authUserId = randomUUID();
  const client = new pg.Client({ connectionString: env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`INSERT INTO commerce.staff_members (auth_user_id, email, display_name, role) VALUES ($1, $2, $3, $4)`, [
      authUserId,
      `${role.toLowerCase()}-${authUserId.slice(0, 8)}@example.test`,
      name,
      role,
    ]);
  } finally {
    await client.end();
  }
  return `${authUserId}:aal2`;
}

async function staffPage(browser: Browser, role: "OPERATIONS" | "SUPPORT" | "FINANCE" | "ADMIN", name?: string) {
  // Reduced motion: accessibility scans must see settled colours, not a mid-transition frame.
  const context = await browser.newContext({ baseURL: env.APP_ORIGIN, reducedMotion: "reduce", extraHTTPHeaders: { "x-test-staff": await staffMember(role, name) }, viewport: { width: 1440, height: 900 } });
  return { context, page: await context.newPage() };
}

async function buy(page: Page, slug: string): Promise<{ url: string; reference: string }> {
  await addSimpleToCart(page, slug);
  await checkoutToPayment(page);
  await pay(page, "+250788123000");
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Your order is confirmed" })).toBeVisible();
  const reference = /BB-[A-Z0-9]{4}-[A-Z0-9]{4}/.exec((await page.getByText(/^Order: BB-/).first().textContent()) ?? "")?.[0];
  expect(reference).toBeTruthy();
  return { url: page.url(), reference: reference! };
}

test("T15: the confirmation SMS link opens the order once, on another device", async ({ page, browser, request }) => {
  const { url, reference } = await buy(page, "detangling-comb");
  await runJobs(request);

  // A second device opens the simulated SMS inbox and follows the private link.
  const phone = await browser.newContext({ baseURL: env.APP_ORIGIN, viewport: { width: 360, height: 780 } });
  const handset = await phone.newPage();
  await handset.goto("/dev/sms");
  const message = handset.getByRole("listitem").filter({ hasText: reference }).filter({ hasText: "is paid" });
  await expect(message).toHaveCount(1);
  const link = message.getByRole("link");
  const href = (await link.getAttribute("href"))!;
  // The short SMS form (DR-049): 32 random bytes on the page /o.
  expect(href).toMatch(/^\/o#[A-Za-z0-9_-]{43}$/);
  const token = href.slice(3);
  await link.click();
  await expect(handset).toHaveURL(url, { timeout: 30_000 });
  await expect(handset.getByText(reference).first()).toBeVisible();
  // The token never stays in the address bar or history entry.
  await handset.goBack();
  expect(handset.url()).not.toContain(token);
  await phone.close();

  // The same link in a third browser is refused, with a support path.
  const third = await browser.newContext({ baseURL: env.APP_ORIGIN });
  const other = await third.newPage();
  await other.goto(href);
  await expect(other.getByRole("heading", { name: "This order link can't be used" })).toBeVisible();
  await expect(other.getByRole("link", { name: "Contact support" })).toBeVisible();
  expect(other.url()).not.toContain(token);
  const scan = await new AxeBuilder({ page: other }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(scan.violations).toEqual([]);
  await third.close();

  // The buyer can also create a one-time link for another device.
  await page.getByRole("button", { name: "Open this order on another device" }).click();
  await page.getByRole("button", { name: "Create private link" }).click();
  await expect(page.getByLabel("Private link", { exact: true })).toContainText("/order-access#token=");
});

test("a customer cancellation request is decided by staff before handover", async ({ page, browser }) => {
  const { reference } = await buy(page, "makeup-sponge-pair");
  await page.getByRole("button", { name: "Ask to cancel this order" }).click();
  const dialog = page.getByRole("dialog", { name: "Ask to cancel this order" });
  await dialog.getByRole("button", { name: "Send request" }).click();
  await expect(dialog.getByText("Tell us why you want to cancel.")).toBeVisible();
  await dialog.getByLabel("Why do you want to cancel?").fill("Ordered the wrong colour");
  await dialog.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Cancellation requested. We will update this page once it is reviewed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask to cancel this order" })).toHaveCount(0);

  const { context, page: ops } = await staffPage(browser, "OPERATIONS");
  await ops.goto("/staff/orders");
  const row = ops.getByRole("row").filter({ hasText: reference });
  await expect(row).toContainText("Cancellation requested");
  await row.getByRole("link", { name: reference }).click();
  await expect(ops.getByText("Customer reason: “Ordered the wrong colour”", { exact: false })).toBeVisible();
  await ops.getByRole("button", { name: "Cancel order" }).click();
  const confirm = ops.getByRole("dialog", { name: "Cancel this order" });
  await expect(confirm).toContainText("refund case opens");
  await confirm.getByLabel("Reason").fill("Customer request before packing");
  await confirm.getByRole("button", { name: "Cancel order" }).click();
  await expect(ops.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await expect(ops.getByText("A refund case is open.")).toBeVisible();
  await context.close();

  await page.reload();
  await expect(page.getByText("Your order is cancelled.").first()).toBeVisible();
});

test("staff fulfil an order through guarded steps; a stale screen gets a conflict, not a forced change", async ({ page, browser }) => {
  const { reference } = await buy(page, "brow-pencil");
  const { context, page: ops } = await staffPage(browser, "OPERATIONS");
  await ops.goto("/staff/orders?state=PAID");
  await ops.getByRole("link", { name: reference }).click();
  await expect(ops).toHaveURL(/\/staff\/orders\/[0-9a-f-]{36}$/);
  await expect(ops.getByRole("heading", { name: `Order ${reference}` })).toBeVisible();
  const orderUrl = ops.url();

  const step = async (button: string, title: string, confirm: string, fill?: (d: ReturnType<Page["getByRole"]>) => Promise<void>) => {
    await ops.getByRole("button", { name: button, exact: true }).click();
    const d = ops.getByRole("dialog", { name: title });
    if (fill) await fill(d);
    await d.getByRole("button", { name: confirm }).click();
    await expect(d).toHaveCount(0);
  };

  // A second tab keeps the old version of the order open.
  const stale = await context.newPage();
  await stale.goto(orderUrl);
  await expect(stale.getByRole("button", { name: "Put on hold", exact: true })).toBeVisible();

  await step("Start preparation", "Start preparation", "Start preparation");
  await expect(ops.getByText("Preparing", { exact: true }).first()).toBeVisible();

  await stale.getByRole("button", { name: "Put on hold", exact: true }).click();
  const staleDialog = stale.getByRole("dialog", { name: "Put order on hold" });
  await staleDialog.getByLabel("Reason").fill("Checking address");
  await staleDialog.getByRole("button", { name: "Put on hold" }).click();
  await expect(staleDialog.getByRole("alert")).toContainText("changed since you opened it");
  await expect(staleDialog.getByRole("button", { name: "Reload the record" })).toBeVisible();

  await step("Assign rider", "Assign rider", "Assign rider", async (d) => d.getByLabel("Rider reference").fill("RIDER-E2E"));
  await expect(ops.getByText("Rider: RIDER-E2E")).toBeVisible();
  await expect(ops.getByRole("button", { name: "Change rider", exact: true })).toBeVisible();
  const scan = await new AxeBuilder({ page: ops }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(scan.violations).toEqual([]);
  await step("Record handover", "Record handover to the rider", "Confirm handover");
  await expect(ops.getByText("With rider", { exact: true }).first()).toBeVisible();
  await expect(ops.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
  await step("Confirm delivery", "Confirm delivery", "Confirm delivery");
  await expect(ops.getByText("Delivered", { exact: true }).first()).toBeVisible();
  await context.close();

  await page.reload();
  await expect(page.getByText("Delivered.").first()).toBeVisible();
});

async function sql(text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

test("DR-043: finance sees a refund the provider's records disagree with, checks the provider ids and closes the review", async ({ page, browser }) => {
  const { reference } = await buy(page, "gloss-clear");
  const { context, page: fin } = await staffPage(browser, "FINANCE");
  await fin.goto("/staff/orders?state=PAID");
  await fin.getByRole("link", { name: reference }).click();
  await expect(fin.getByRole("heading", { name: `Order ${reference}` })).toBeVisible();

  await fin.getByRole("button", { name: /^Request refund from the payment verified/ }).click();
  const request = fin.getByRole("dialog", { name: "Request a refund" });
  await request.getByLabel("Amount (RWF)").fill("1000");
  await request.getByLabel("Reason").fill("Damaged lid");
  await request.getByRole("button", { name: "Record request" }).click();
  await expect(request).toHaveCount(0);
  await fin.getByRole("button", { name: "Approve refund of RWF 1,000" }).click();
  const approve = fin.getByRole("dialog", { name: "Approve refund" });
  await approve.getByLabel("Reason").fill("Photo checked");
  await approve.getByRole("button", { name: "Approve refund" }).click();
  await expect(approve).toHaveCount(0);

  // The provider refuses it because its records say the payment was already refunded
  // (set directly here: the payment simulator has no such case).
  await sql(
    `UPDATE commerce.refunds f SET state = 'FAILED', failure_code = 'INVALID_STATE', verification_flag = 'NEEDS_REVIEW', verified_at = now(), version = f.version + 1
       FROM commerce.refund_cases c JOIN commerce.orders o ON o.id = c.order_id WHERE f.case_id = c.id AND o.reference = $1`,
    [reference],
  );
  await fin.reload();
  await expect(fin.getByText("Provider records differ: finance review")).toBeVisible();
  const providerRefundId = (await sql(`SELECT f.provider_refund_id::text AS id FROM commerce.refunds f JOIN commerce.refund_cases c ON c.id = f.case_id JOIN commerce.orders o ON o.id = c.order_id WHERE o.reference = $1`, [reference])).rows[0].id as string;
  await expect(fin.getByRole("region", { name: "Refunds" }).getByText(providerRefundId)).toBeVisible();
  await expect(fin.getByRole("region", { name: "Verified payments" }).getByText("Provider id")).toBeVisible();
  // Asking for another refund from this payment warns first.
  await fin.getByRole("button", { name: /^Request refund from the payment verified/ }).click();
  const again = fin.getByRole("dialog", { name: "Request a refund" });
  await expect(again).toContainText("differ from ours");
  await again.press("Escape");
  await expect(again).toHaveCount(0);
  const scan = await new AxeBuilder({ page: fin }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(scan.violations).toEqual([]);

  await fin.goto("/staff/finance");
  await expect(fin.getByRole("heading", { name: "Refunds where the provider's records differ (1)" })).toBeVisible();
  await fin.getByRole("link", { name: reference }).last().click();
  await expect(fin.getByRole("button", { name: "Paid by provider: record the refund of RWF 1,000 as paid" })).toBeVisible();
  await fin.getByRole("button", { name: "Records match: close the review of the refund of RWF 1,000" }).click();
  const close = fin.getByRole("dialog", { name: "Close the review: the provider agrees with our record" });
  await expect(close).toContainText("no refund of this payment was made by any other route");
  await close.getByRole("button", { name: "Close review" }).click();
  await expect(close.getByText("Required.")).toBeVisible();
  await close.getByLabel("What the provider's dashboard shows").fill("Dashboard: no refund under this id; the payment was refunded from the dashboard");
  await close.getByRole("button", { name: "Close review" }).click();
  await expect(close).toHaveCount(0);
  await expect(fin.getByText("Provider records differ: finance review")).toHaveCount(0);
  await fin.goto("/staff/finance");
  await expect(fin.getByRole("heading", { name: /Refunds where the provider's records differ/ })).toHaveCount(0);
  await context.close();
});

test("staff upload a product photo; it is checked and shown as awaiting review", async ({ browser }) => {
  const { context, page: ops } = await staffPage(browser, "OPERATIONS");
  await ops.goto("/staff/catalog/new");
  await expect(ops.getByRole("heading", { name: "New product draft" })).toBeVisible();
  const png = await sharp({ create: { width: 900, height: 900, channels: 3, background: { r: 220, g: 140, b: 160 } } }).png().toBuffer();
  await ops.getByLabel("Describe the photo").fill("Front of the jar");
  await ops.getByRole("button", { name: "Upload photo" }).click();
  await expect(ops.getByRole("alert").filter({ hasText: /\S/ })).toContainText("Choose a JPEG, PNG or WebP photo.");
  await ops.getByLabel("Choose a photo").setInputFiles({ name: "jar.png", mimeType: "image/png", buffer: png });
  await ops.getByRole("button", { name: "Upload photo" }).click();
  await expect(ops.getByLabel("Photo 1 description")).toHaveValue("Front of the jar");
  await expect(ops.getByText("Awaiting review")).toBeVisible();
  const thumb = ops.locator('img[src*="/media/products/"]');
  await expect(thumb).toHaveCount(1);
  // The preview loads asynchronously (from the private bucket when storage is hosted).
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 20_000 }).toBe(true);
  // A fake image is refused by the server after decoding.
  await ops.getByLabel("Describe the photo").fill("Not really a photo");
  await ops.getByLabel("Choose a photo").setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not an image at all") });
  await ops.getByRole("button", { name: "Upload photo" }).click();
  await expect(ops.getByRole("alert").filter({ hasText: /\S/ })).toContainText("could not be read as an image");
  await context.close();
});

test("T16 in the browser: an administrator disables a member, who is refused on the next request", async ({ browser }) => {
  const leaver = await staffPage(browser, "SUPPORT", "E2E Leaver");
  await leaver.page.goto("/staff/orders");
  await expect(leaver.page.getByRole("heading", { name: "Orders" })).toBeVisible();

  const { context, page: admin } = await staffPage(browser, "ADMIN");
  await admin.goto("/staff/team");
  await admin.getByRole("button", { name: "Change access for E2E Leaver" }).click();
  const dialog = admin.getByRole("dialog", { name: "Change access for E2E Leaver" });
  await dialog.getByLabel("Access", { exact: true }).selectOption("false");
  await dialog.getByLabel("Reason").fill("Left the company");
  await dialog.getByRole("button", { name: "Save access" }).click();
  await expect(admin.getByRole("row").filter({ hasText: "E2E Leaver" })).toContainText("Disabled");
  await context.close();

  await leaver.page.reload();
  await expect(leaver.page.getByRole("heading", { name: "No staff access" })).toBeVisible();
  // RF-12: the page itself refuses too, so no order data travels in the page payload.
  expect(await leaver.page.content()).not.toMatch(/BB-[A-Z0-9]{4}-[A-Z0-9]{4}/);
  await leaver.context.close();
});

test("A07: an administrator saves a new settings version; finance can only read it", async ({ browser }) => {
  const { context, page: admin } = await staffPage(browser, "ADMIN");
  await admin.goto("/staff/settings");
  await expect(admin.getByRole("heading", { name: "Settings" })).toBeVisible();
  const version = Number(/Version (\d+)/.exec((await admin.getByText(/^Version \d+\./).textContent()) ?? "")?.[1]);
  await expect(admin.getByText(/Preview: 3 km: RWF 1,500/)).toBeVisible();
  const scan = await new AxeBuilder({ page: admin }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(scan.violations).toEqual([]);
  await admin.getByLabel("Quote valid for (seconds)").fill("600");
  await admin.getByRole("button", { name: "Save new version" }).click();
  await expect(admin.getByText("Give a reason for the change.")).toBeVisible();
  await admin.getByLabel("Reason for this change").fill("Shorter quote validity during the rehearsal");
  await admin.getByRole("button", { name: "Save new version" }).click();
  await expect(admin.getByText("Saved as a new settings version.")).toBeVisible();
  await expect(admin.getByText(`Version ${version + 1}.`)).toBeVisible();
  await context.close();

  const finance = await staffPage(browser, "FINANCE");
  await finance.page.goto("/staff/settings");
  await expect(finance.page.getByText("Only an administrator can change settings.")).toBeVisible();
  await expect(finance.page.getByLabel("Quote valid for (seconds)")).toBeDisabled();
  await expect(finance.page.getByRole("button", { name: "Save new version" })).toHaveCount(0);
  await finance.context.close();
});

test("an administrator adds a supplier; operations sees the list without settlement tools", async ({ browser }) => {
  const { context, page: admin } = await staffPage(browser, "ADMIN");
  await admin.goto("/staff/suppliers");
  await admin.getByRole("button", { name: "Add supplier" }).click();
  const dialog = admin.getByRole("dialog", { name: "Add a supplier" });
  await dialog.getByLabel("Supplier name").fill("E2E Cosmetics Ltd");
  await dialog.getByLabel("Agreement reference").fill("AGR-E2E-1");
  await dialog.getByRole("button", { name: "Add supplier" }).click();
  await expect(admin.getByRole("row").filter({ hasText: "E2E Cosmetics Ltd" })).toContainText("AGR-E2E-1");
  await expect(admin.getByRole("heading", { name: "Amounts owed to suppliers" })).toBeVisible();
  await context.close();

  const ops = await staffPage(browser, "OPERATIONS");
  await ops.page.goto("/staff/suppliers");
  await expect(ops.page.getByRole("row").filter({ hasText: "E2E Cosmetics Ltd" })).toBeVisible();
  await expect(ops.page.getByRole("button", { name: "Add supplier" })).toHaveCount(0);
  await expect(ops.page.getByRole("heading", { name: "Amounts owed to suppliers" })).toHaveCount(0);
  await ops.context.close();
});
