import { createHash } from "node:crypto";
import { test as base, expect, type BrowserContext } from "@playwright/test";

// Every browser test fails if the page reports a Content-Security-Policy violation
// (DR-039). The production build runs with the strict policy, so a blocked inline style,
// an un-nonced <style> element or a stray script shows up here, not only in a console.
//
// Violations reach the test two ways: Chromium logs them to the console, and an init
// script forwards each `securitypolicyviolation` event as a console error. Init scripts
// run through the DevTools protocol, so the page's own CSP does not block them.
const MARK = "[csp-violation]";

async function watch(context: BrowserContext, violations: string[]) {
  await context.addInitScript((mark) => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(
        `${mark} ${e.effectiveDirective} blocked=${e.blockedURI || "inline"} sample=${(e.sample || "").slice(0, 80)} at ${location.pathname}`,
      );
    });
  }, MARK);
  context.on("console", (msg) => {
    const text = msg.text();
    if (
      msg.type() === "error" &&
      (text.startsWith(MARK) || /Content Security Policy/i.test(text))
    )
      violations.push(text);
  });
}

// Each isolated browser test represents a different synthetic visitor. Sharing the
// same proxy address across the entire suite exhausts the real 30-session/10min limit.
// Keep production limits intact; use documentation-only IPv6 addresses in this harness.
const visitorAddress = (id: string) =>
  "2001:db8:" +
  createHash("sha256")
    .update(id)
    .digest("hex")
    .slice(0, 24)
    .match(/.{4}/g)!
    .join(":");

export const test = base.extend<{ cspGuard: void }>({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, run, info) => {
    await run({
      ...extraHTTPHeaders,
      "x-forwarded-for": visitorAddress(info.testId),
    });
  },
  cspGuard: [
    // The fixture callback is named `run` (not Playwright's usual `use`) so the React
    // hooks lint rule does not mistake it for React's use() hook.
    async ({ context, browser }, run, info) => {
      const violations: string[] = [];
      await watch(context, violations);
      // Tests that open a second browser (another device, a stranger, a staff member) get
      // the same guard: wrap newContext for the duration of this test only.
      const own = Object.getOwnPropertyDescriptor(browser, "newContext");
      const original = browser.newContext;
      browser.newContext = async (options = {}) => {
        const created = await original.call(browser, {
          ...options,
          extraHTTPHeaders: {
            ...options.extraHTTPHeaders,
            "x-forwarded-for": visitorAddress(info.testId),
          },
        });
        await watch(created, violations);
        return created;
      };
      try {
        await run();
      } finally {
        // Put back exactly what was there (normally nothing: the method lives on the prototype).
        if (own) Object.defineProperty(browser, "newContext", own);
        else delete (browser as { newContext?: unknown }).newContext;
      }
      expect(violations, "Content-Security-Policy violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export type { APIRequestContext, Browser, Page } from "@playwright/test";
