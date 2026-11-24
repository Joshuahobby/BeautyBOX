# BeautyBOX Phase 1

One BeautyBOX storefront that sells only stock held at the BeautyBOX shop:

- guest checkout
- RWF pricing
- one dispatch origin with distance-quoted delivery
- MTN MoMo and Airtel Money through pawaPay

The original handoff is not present in this checkout. The reproducible API baseline is pinned under `docs/api/baseline`; the active additive contract is `docs/api/API-Contract-v1.2.openapi.json`. Current decisions and recovery scope are recorded in `docs/CONTINUATION-PLAN.md`.

**Status (24 November 2026):** Phase 1 is built and tested with synthetic data. SMS moves to after launch; order e-mail replaces it (DR-057). Staging has been live at `staging.beautyboxmarket.com` since 25 October, behind an access code, with pawaPay sandbox, simulated routing and SMS off. `beautyboxmarket.com` shows "Launching soon". Public checkout stays closed until every release gate (G1–G5) passes and the founder authorizes launch. **Where things stand and what blocks launch:** `docs/PROGRESS.md` (top section) and `docs/RELEASE-CHECKLIST.md`.

| Read                                   | For                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `docs/PROGRESS.md`                     | **Start here:** where Phase 1 stands, launch blockers with owners, history of work           |
| `docs/RELEASE-CHECKLIST.md`            | Release gates G0–G5 and their evidence                                                       |
| `docs/READINESS-IMPROVEMENTS.md`       | PR #7: stock CSV, CI checks, phone staff flows, recovery, images, SMS adapter                |
| `docs/CONTENT-REVIEW.md`               | Draft storefront content and policies, and the facts the business must still supply          |
| `docs/STAGING-MERGE.md`                | PR #6, staging merge/deployment handoff and preserved hosted data/settings                   |
| `docs/DETAIL-AUDIT.md`                 | Fresh detailed review, fixes, screenshots and remaining blockers                             |
| `docs/SCOPE-COVERAGE.md`               | Every reviewed feature and optional item, including explicit deferrals                       |
| `docs/integrations/GOOGLE-DELIVERY.md` | Silverback Mall, Kigali boundary/tariff, local configuration and billing-blocked live checks |
| `docs/design-explorations/README.md`   | Individual recovered visual references and design index                                      |
| `docs/SETUP.md`                        | Local setup, review path, test commands                                                      |
| `docs/DEPLOYMENT.md`                   | Staging on beautyboxmarket.com behind the pre-launch wall (Vercel, Supabase, Cloudflare)     |
| `docs/DECISION-LOG.md`                 | Implementation decisions (DR-001…)                                                           |
| `docs/COMPATIBILITY.md`                | Pinned versions and why                                                                      |
| `docs/CONTRACT-CHANGES.md`             | Additive API changes against the handoff OpenAPI                                             |
| `docs/TEST-EVIDENCE.md`                | Tests actually run, with results                                                             |

## Layout

```
src/app            routes (storefront pages, /api/v1 handlers)
src/modules        server-only domain logic (catalog, cart, checkout, delivery, payments, inventory, orders, jobs, ...)
src/adapters       replaceable providers (payments, routing/places, SMS); fakes for local/test
src/components     UI primitives and commerce components (tokens from src/design/tokens.json)
src/messages       English message catalog (copy externalised for reviewed translation)
prisma             schema, migrations, reviewed invariant SQL
scripts            local database, setup, seed, worker, design token/font builders
tests              unit, integration (real PostgreSQL), e2e (Playwright + axe)
```
