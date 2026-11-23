# Homepage launch polish

Prepared 16 November 2026 from the current GitHub main commit `f74ff554462a49836be88bbd4ec65d199e0596f1`. The upstream ref was fetched and unchanged before release preparation. The earlier audit of `197e926` is superseded.

## Changes

- Preserve the deployed editorial design and three manual hero slides. Keep the hero copy, primary action and campaign artwork clear at phone, tablet and desktop widths; make the Kigali shop introduction explicit.
- Improve section headings, category labels, small-screen actions, ritual spacing and tablet header search. The mobile category menu uses the existing header search rather than presenting a second search form.
- Add the BeautyBOX introduction, shopping guide and five-question FAQ, with working About and Help destinations.
- Complete About, Help and readable policy drafts using the supplied Phase 1 documents and current implementation. Source decisions and genuine business inputs still needed are recorded in [CONTENT-REVIEW.md](CONTENT-REVIEW.md).
- Exclude products with unsupported active parcel options from homepage recommendations before pagination. Explain special-delivery cart blocks and keep removal controls accessible so the customer can recover.
- Add a non-secret deployment revision response header when Vercel provides its Git SHA, so reviews can confirm the deployed version.

## Verification

- `npm run verify`: token and API-contract checks, TypeScript, ESLint and 132 unit tests passed.
- `npm run test:integration`: 187 passed, six skipped. Skips are the explicitly enabled external pawaPay sandbox and Supabase Storage suites; they are not claims of live-provider verification.
- Focused production-build Chromium suite: 14 passed across storefront, content and purchase-option scenarios. Covers all three slides, hero geometry at seven tablet/desktop breakpoints, keyboard menus, mobile search/category navigation, price and brand discovery, product images, special-parcel recovery, option changes and cart merging.
- Content checks at 360, 768 and 1440 pixels: About, Help and all three policies have no horizontal overflow, no bracket placeholders and no automated WCAG A/AA violations. Draft notices remain visible.
- Visual inspection of the full homepage at 390 and 1440 pixels, phone About/returns and desktop Help. Captures are kept in the private, ignored local review directory.
- Browser execution uses system Chromium 155 because the pinned browser download is unavailable in this environment. Local tests use the isolated test database and simulated providers.

## Staging scope

No database schema, migrations, inventory reseed, dependencies or hosted settings change. Keep the existing access wall, public holding page, staging/demo environment, payment sandbox, fake routing and disabled SMS. Policies remain unapproved drafts. This release does not open public ordering.

After merging through the authenticated repository owner, confirm the merge SHA's Vercel status and the protected storefront's revision header. Verify the new content, three slides, navigation and cart against the hosted catalogue. Hosted products and photographs can differ from local reference data; do not reset staging to reproduce screenshots.

## Readiness follow-up

The readiness PR preserves this homepage update and the approved carousel, menus, product/cart journey and business decisions. It adds responsive copies of the existing artwork without replacing originals or real SKU photographs, plus loading/read recovery. Current measurements, verification and direct PNG previews are in [READINESS-IMPROVEMENTS.md](READINESS-IMPROVEMENTS.md). Existing Vercel PR preview automation is observed; no hosted configuration/data change or public launch is authorized.
