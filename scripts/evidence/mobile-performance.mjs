// Local production builds only. Identical cold-run lab protocol for before/after.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
const origin = process.env.BEAUTYBOX_PREVIEW_ORIGIN ?? "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Use a local production build.");
const label = process.argv[2];
if (!["before", "after"].includes(label))
  throw new Error("Choose before or after.");
const sourceDirectory = process.env.BEAUTYBOX_SOURCE_DIRECTORY ?? process.cwd();
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: sourceDirectory,
  encoding: "utf8",
}).trim();
const dirty = Boolean(
  execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: sourceDirectory,
    encoding: "utf8",
  }).trim(),
);
const protocol = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  cpuSlowdown: 4,
  latencyMs: 100,
  downloadBytesPerSecond: 200000,
  cache: "disabled",
  coldRuns: 3,
  path: "/",
  settleMs: 2500,
};
const outputDirectory = path.resolve("docs/evidence/readiness");
fs.mkdirSync(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const runs = [];
try {
  for (let run = 1; run <= protocol.coldRuns; run++) {
    const context = await browser.newContext({
      viewport: protocol.viewport,
      deviceScaleFactor: protocol.deviceScaleFactor,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: protocol.latencyMs,
      downloadThroughput: protocol.downloadBytesPerSecond,
      uploadThroughput: protocol.downloadBytesPerSecond,
      connectionType: "cellular4g",
    });
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: protocol.cpuSlowdown,
    });
    const imageRequests = new Map();
    cdp.on("Network.responseReceived", (event) => {
      if (event.type === "Image")
        imageRequests.set(event.requestId, {
          url: new URL(event.response.url).pathname,
          bytes: 0,
        });
    });
    cdp.on("Network.loadingFinished", (event) => {
      const image = imageRequests.get(event.requestId);
      if (image) image.bytes = event.encodedDataLength;
    });
    await page.addInitScript(() => {
      window.__bbVitals = { lcp: null, cls: 0 };
      let windowStart = 0,
        lastShift = 0,
        windowValue = 0;
      new PerformanceObserver((list) => {
        const entry = list.getEntries().at(-1);
        if (entry)
          window.__bbVitals.lcp = {
            ms: entry.startTime,
            element: entry.element?.tagName ?? null,
            image: entry.url ? new URL(entry.url).pathname : null,
          };
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue;
          if (
            entry.startTime - lastShift > 1000 ||
            entry.startTime - windowStart > 5000
          ) {
            windowStart = entry.startTime;
            windowValue = 0;
          }
          windowValue += entry.value;
          lastShift = entry.startTime;
          window.__bbVitals.cls = Math.max(window.__bbVitals.cls, windowValue);
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(origin + protocol.path, {
      waitUntil: "networkidle",
      timeout: 120000,
    });
    await page.waitForTimeout(protocol.settleMs);
    const vitals = await page.evaluate(() => window.__bbVitals);
    const imageTransfers = [...imageRequests.values()];
    const images = await page.locator("img").evaluateAll((images) =>
      images
        .filter(
          (image) =>
            image.getBoundingClientRect().top < innerHeight &&
            image.getBoundingClientRect().bottom > 0,
        )
        .map((image) => ({
          source: new URL(image.currentSrc || image.src, location.href)
            .pathname,
          renderedWidth: image.getBoundingClientRect().width,
          naturalWidth: image.naturalWidth,
        }))
        .filter((image) => image.renderedWidth > 0),
    );
    if (!vitals.lcp || images.some((image) => !image.naturalWidth))
      throw new Error("Incomplete performance run.");
    runs.push({
      run,
      ...vitals,
      imageBytes: imageTransfers.reduce((sum, image) => sum + image.bytes, 0),
      imageTransfers,
      images,
    });
    if (run === 1)
      await page.screenshot({
        path: path.join(outputDirectory, `performance-${label}.png`),
      });
    await context.close();
  }
} finally {
  await browser.close();
}
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const report = {
  measuredAt: new Date().toISOString(),
  sourceCommit,
  trackedWorktreeChanges: dirty,
  chromium: browser.version(),
  mode: "local production build, TEST fixtures; laboratory evidence, not field data",
  protocol,
  medians: {
    lcpMs: median(runs.map((run) => run.lcp.ms)),
    cls: median(runs.map((run) => run.cls)),
    imageBytes: median(runs.map((run) => run.imageBytes)),
  },
  runs,
};
fs.writeFileSync(
  path.join(outputDirectory, `performance-${label}.json`),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify({ label, sourceCommit, medians: report.medians }));
