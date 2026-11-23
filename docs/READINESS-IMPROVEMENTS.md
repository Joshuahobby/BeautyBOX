# BeautyBOX readiness improvements

Authorized 16 November 2026. Application work was reviewed in [PR #7](https://github.com/Joshuahobby/BeautyBOX/pull/7), branch `codex/beautybox-readiness-improvements`, and merged by the repository owner on 18 November as `9249ab6`. Its app/test head is `ab880612199b017113dbffb189962bbce0b33550`; the current-main baseline incorporated during implementation was `cab19df5b5966656bb4f3e60109f2f58f99a9627`. The direct evidence below was completed on 23 November without changing hosted settings or data.

## Implementation and review paths

| Improvement | Result and evidence |
| --- | --- |
| Reliable stock CSV | Header-only download plus upload/paste. Exact eight columns; BOM/CRLF, quoted commas, escaped quotes and multiline cells; 256 KiB/1,000 client rows; explicit ownership, safe whole numbers and real dates. Source edits invalidate preview. Uncertain apply freezes the original body/key and offers Check import outcome. Server retains reviewed-SKU, supplier, duplicate-lot, expiry, source-hash and idempotency checks; authenticated JSON streaming retains 512 KiB. [Stock runbook](STOCK-IMPORT.md); `stock-csv.test.ts`, `readiness.test.ts`, phone regressions. |
| GitHub quality checks | PRs to main: Node 22, npm ci, PostgreSQL 16, Chromium, generated isolated settings, verification, sequential database/browser tests and optional preflight. PostgreSQL uses loopback TCP with Unix sockets disabled. No hosted secrets or branch-protection edits. [Quality run 43924106773](https://github.com/Joshuahobby/BeautyBOX/actions/runs/43924106773) passed for `ab88061`; its Vercel status also succeeded. |
| Staff phone workflows | Layout/reflow fixes at 320/360 CSS px for headers, grids, fields, file inputs and dialogs. Actual decoded photo upload, new/existing variant edits, invalid-field focus, saved IDs/version tracking, uncertain save/action/refund recovery, dialog close/reopen and stale-version refusal. Support can REQUEST a refund; approval remains Finance/Admin. [Operating runbook](RUNBOOKS.md). |
| Loading and recoverable reads | Shop/product/workspace loading shells and focused generic read recovery use installed Next 16.4.2 retry(). Cart/workspace chrome stays outside the boundaries. No mutation/payment auto-replay. TEST-only fail/delay probes are unavailable in LOCAL/STAGING/PRODUCTION; staff probe rechecks access. Visible-content locators account for transient hidden React streaming buffers. |
| Responsive images | 51 Sharp-derived WebP copies (320/480/768) from 17 unchanged originals, with verified source/output SHA-256, dimensions, srcset/sizes and intentional loading priority. Only exact editorial paths receive variants; reviewed real SKU photographs and missing-image behavior are preserved. Current baseline/after protocol and measurements are below. |
| Africa's Talking SMS | Private configuration and mocked transport/outbox tests, sending disabled by default. Fixed official endpoints, 64 KiB streamed response cap, timeout and no adapter retries. Exact-recipient acceptance is not handset delivery. Ambiguous outcomes stay UNKNOWN and are not blindly resent; explicit rejection uses existing bounded outbox retries. SMS cannot determine money, stock or refunds. [SMS runbook](integrations/AFRICASTALKING.md). |

## Verification

Fresh local `npm run verify` passes 195 unit tests, token/contract/image-hash checks, TypeScript and ESLint. PostgreSQL integration passes 192 tests, with six external-service cases skipped. One clean production-build browser run passes all 72 cases. Twelve direct PNG previews were captured and inspected; automated capture found zero horizontal overflow and zero broken images. [Machine-readable verification](evidence/readiness/verification.json) and [optional preflight](evidence/readiness/optional-preflight.json) record the exact limits.

Local tools: Node 22.23.1, PostgreSQL 17, system Chromium 155 (the environment blocks the Playwright download). GitHub uses PostgreSQL 16 and Playwright-pinned Chromium. Integration and browser database resets run sequentially against local `beautybox_test` only. The optional preflight makes zero provider requests and changes no settings; external accounts do not block offline implementation.

## Mobile performance protocol

Three cold runs per build: 390×844 CSS px, DPR 2, CPU slowdown 4×, latency 100 ms, 200,000 bytes/s download, disabled browser cache, new browser context each run, no scrolling and the same freshly seeded demo catalogue. Both measurements use the same Chromium executable. Image bytes are CDP Network.loadingFinished encoded transfer bytes, including response overhead; CLS uses session windows. These are local laboratory measurements, not field or live-service evidence.

The baseline is a separate clean checkout of pre-readiness main `cab19df`, leaving feature work intact. [Baseline JSON](evidence/readiness/performance-before.json) and [baseline PNG](evidence/readiness/performance-before.png): median LCP 5,704 ms, CLS 0.00251346, image transfers 942,371 bytes. [After JSON](evidence/readiness/performance-after.json) and [after PNG](evidence/readiness/performance-after.png) for `ab88061`: median LCP 1,068 ms, CLS 0.00251346, image transfers 131,712 bytes. Under this protocol, median LCP fell 81.3%, image transfer fell 86.0%, and CLS was unchanged. The older handoff baseline (5,916 ms / 764,258 bytes) is historical and is not substituted for the current homepage.

## Direct visual evidence

- Storefront: [mobile homepage](evidence/readiness/home-mobile.png), [desktop homepage](evidence/readiness/home-desktop.png), [mobile product](evidence/readiness/product-mobile.png).
- Staff product and stock: [product at 320 px](evidence/readiness/staff-product-320.png), [product at 360 px](evidence/readiness/staff-product-360.png), [ready import at 320 px](evidence/readiness/staff-import-320.png), [ready import at 360 px](evidence/readiness/staff-import-360.png), [uncertain import recovery at 320 px](evidence/readiness/staff-import-uncertain-320.png).
- Staff resilience and guarded actions: [loading](evidence/readiness/staff-loading.png), [read recovery](evidence/readiness/staff-recovery.png), [order action dialog](evidence/readiness/staff-order-dialog-320.png), [Finance refund dialog](evidence/readiness/staff-finance-dialog-320.png).

[Capture metadata](evidence/readiness/captures.json) binds all previews to `ab88061`, local production mode, isolated TEST data and fake providers. The uploaded product image is a decoded synthetic test fixture, not launch photography.

## Preserved business and release decisions

Dispatch stays Silverback Mall, Kicukiro: **-1.9688464, 30.1025134**. Launch boundary stays the City of Kigali; nationwide delivery is future work. Starting tariff stays RWF 1,500 through 3 road km, then RWF 250/km, rounded upward to RWF 100. Google motorcycle routing has no guessed-distance fallback; live billing/coverage evidence remains pending.

SMS stays disabled. No main merge, public launch, cloud-environment publication, hosted settings/data change, real SMS or real payment is performed by this work. Pushing checkpoints uses the existing Vercel PR-preview integration; observed preview checks do not prove live-service acceptance. New commits use the connected GitHub account without rewriting historical authorship.

## Remaining owner inputs

- Current isolated Supabase Storage URL/secret for the two opt-in tests; pawaPay sandbox configuration for four opt-in tests. No production credentials are substituted.
- Google billing, restricted server/browser keys and explicit motorcycle-coverage/live-route evidence.
- Africa's Talking account, approved sender, credit, reviewed copy/private-link/multipart behavior and a controlled real handset-delivery check before separately authorizing live enablement.
- Existing launch gates still need real stock/counts/costs, approved photographs/copy, policies/contacts/service operations, live merchant/refund evidence, hosted recovery and real-device/assistive-technology review. This PR does not approve those inputs.
