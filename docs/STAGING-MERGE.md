# Staging merge handoff

Prepared 16 November 2026 for [PR #6](https://github.com/Joshuahobby/BeautyBOX/pull/6), `codex/beautybox-storefront-rebuild` → `main`.

## What the merge changes

The selected editorial homepage, slides, mega menus, catalogue, product/shade/cart experience, checkout review and mobile staff improvements ship together. Demo image fallbacks are static files included with the application; reviewed product photos still take precedence. Detailed scope and deliberate deferrals remain in [SCOPE-COVERAGE.md](SCOPE-COVERAGE.md).

No database schema, migration, dependency lockfile or Vercel project configuration changes are required by this branch. The checked `main` revision is `197e926c56dab50f0218ffdd017e40aeb039d79f`, an ancestor of the feature branch. No reset or reseed of staging is part of this handoff.

## Vercel authorization and merge route

Vercel's [PR comment](https://github.com/Joshuahobby/BeautyBOX/pull/6#issuecomment-6910961752) says the feature-commit author, `cyamunararwanda-coder`, is not a member of the BeautyBOX Vercel team. This is a deployment authorization failure; it is not evidence of a failed application build. This environment has no Vercel account connection and has not changed team membership or billing.

The preparation checkpoint is created through the authenticated `Joshuahobby` GitHub account, using GitHub's default author/committer metadata. It preserves the original feature commits and their authors; no history is rewritten. Verify its GitHub author and latest Vercel check on the PR before merging. Preview builds have no staging runtime secrets by design, so a passing preview build is not an end-to-end hosted checkout test.

The current deployed-main commit was authored by `Joshuahobby` and committed by GitHub. When the merge is authorized, use GitHub's **Create a merge commit** while signed in as `Joshuahobby`, matching that previous staging merge route. Confirm the resulting commit's author and Vercel deployment status; staging is not considered updated until Vercel reports Ready for that SHA. Do not force-push rewritten authors, change the repository's visibility or upgrade a plan to conceal a preview failure.

## Preserve the staging environment

- Keep `APP_ENV=staging`, `PAYMENT_PROVIDER=pawapay`, `PAWAPAY_MODE=sandbox`, `ROUTING_PROVIDER=fake`, `SMS_PROVIDER=disabled`, the demo notice and existing access wall.
- Keep the public main domain's holding-page host configuration. A staging review does not open public sales or the launch list.
- Google billing/coverage is not needed to view the redesigned pages. Leave `GOOGLE_TWO_WHEELER_COVERAGE_APPROVED=false`; Google server keys and a separate browser Embed key remain optional for this review.
- The staging template and environment-push helper now include all four Google settings. Routes and Places keys are classified as sensitive; the public Embed key is separate. Placeholder-only dry-run/local-CLI checks verify the names, secrecy flags and exclusion of owner database credentials. No real Vercel environment push was performed.
- Existing hosted inventory, pictures, orders and settings remain database-backed. The merge does not create the local-only reference products or replace the hosted dispatch pin/tariff. If those are wanted on staging later, make a separate versioned data update; never reset the database to reproduce local screenshots.

## Verify after an authorized merge

1. In Vercel, confirm the production deployment for this project's `main` branch reaches Ready and points to the merge SHA. This project's production deployment serves the **staging** site; `APP_ENV` must remain `staging`.
2. Open [staging access](https://staging.beautyboxmarket.com/access) and use the existing code. Confirm the ivory/coral/aubergine homepage, three slide controls and category mega menus.
3. Open `/shop`, apply a category and price filter, inspect a product and use cart controls. Existing staging catalogue data can differ from the local demo screenshots.
4. Confirm the staging access wall, public holding page, demo notice and staff sign-in still work. Do not make a real payment or send SMS for a design review.
5. If the deployment fails, retain the previous deployment. If an issue appears after activation, Vercel's existing Instant Rollback can restore the previous compatible build; there are no new schema migrations to undo.

## Verification evidence

Fresh merge-candidate results are recorded in `evidence/staging-merge/verification.json`. Earlier screenshots, findings, operational drills and optional external-service limits remain in [DETAIL-AUDIT.md](DETAIL-AUDIT.md). No main merge, hosted settings change or cloud-environment publication was performed while preparing this handoff.
