# Implementation progress

## Storefront rebuild checkpoint — 16 November 2026

The Signature-inspired homepage and catalogue are rebuilt on `codex/beautybox-storefront-rebuild`: editorial imagery/type, full supplied lockup, manual featured slides, accessible department mega menus, mobile category disclosure, real category/brand/budget discovery, and restored product-card presentation. Seventeen generated assets are stored in Git; fourteen are explicitly demo-only packshots. Reviewed real SKU images retain precedence. No fabricated promotions/reviews/shops are introduced. Brand filters now survive price filtering, and the catalogue keeps URL-driven search/filter/sort/pagination.

Fresh verification: **90 unit tests**, **156 integration tests** (6 optional live cases skipped), production build and **10 targeted browser checks** passed. The visual QA passed with saved desktop/mobile, mega-menu and source-comparison evidence in `docs/evidence/storefront-rebuild/`; `design-qa.md` records fixes and accepted product constraints. The exact committed v1.1 API contract is now the pinned reproducible baseline; the missing external v1.0 handoff was not reconstructed.

This checkpoint does not claim the later product/shade/cart UI or Kigali/Google restoration is complete. Those are next. Google billing remains an owner-side blocker; no Google live calls or hosted deployment/settings changes were performed. Earlier entries below describe the existing base application and its historical evidence.

Updated 2026-11-01. Local build, plus the staging deployment live since 2026-10-25 (DR-044, `docs/DEPLOYMENT.md`): synthetic data, pawaPay sandbox, simulated routing, no SMS. Evidence for every "verified" claim is in [TEST-EVIDENCE.md](TEST-EVIDENCE.md); review findings and their fixes are in [REVIEW-FINDINGS.md](REVIEW-FINDINGS.md).

## Backlog status

| Slice | Scope | Status |
| --- | --- | --- |
| I01 | Repo, pinned toolchain, local PostgreSQL, migrations, invariants SQL, env validation | Verified |
| I02 | Design tokens, Manrope WOFF2, shell, components, storefront pages | Verified (browser + axe at 360/768/1440, 320 reflow) |
| I03 | Catalog read API, search/filter/sort, availability | Verified |
| I04 | Guest session, cart, checkout, recipient/pin, server quote | Verified (T13, T14, T22) |
| I05 | Payment intent, idempotency, simulator, callbacks, status checks, reservations | Verified (T01-T08, T10, T17, T24) |
| I06 | Verified success → committed stock → private order page | Verified (browser purchase path) |
| I08 | Staff identity (Supabase Auth + MFA, test provider), roles, catalog drafts/publication, photo upload (local or Supabase Storage, DR-041), stock adjust/import, staff access | Verified (T16, T18, T23, photo pipeline, browser; Supabase adapter against the live dev buckets) |
| I09 | Order queue/detail, guarded commands incl. redelivery after a failed attempt, customer cancellation requests, supplier attribution and obligations | Verified (T09 both winners, AT11, browser staff flow) |
| I10 | Refunds (budget, serialized submission that never gives up, mismatch handling), reconcile operations, finance queues, supplier settlement evidence | Verified (T11, T12, RF-09/11/16) |
| I11 | Private links, per-order sessions, reissue (cuts off old access), SMS with retry and alerts, simulated SMS inbox | Verified (T15, T19, RF-22/25) |
| I12 | Settings (A07: pin, area, tariff, hours, parcel limits, quote expiry, checkout pause) | Verified (versioned settings, quote invalidation, production guard). **Google routing adapter not started:** needs a key decision and the routing pilot. |
| I13 | Backup/restore drill (T20 local), runbooks, monitoring probe, reconciliation sweep, checkout switch, strict style CSP (DR-039), staff self-service password reset (DR-040) | Verified locally. Open: hosted restore rehearsal. |
| Staging | Hosting on Vercel + Supabase (TLS to the database, transaction pooler, `prisma generate` on install, Supabase Cron job runner, staging-only seed, settings push allow-list), pre-launch wall on the real domain, launch list with its own privacy notice (DR-044, DR-045, CC-20) | **Live since 2026-10-25** at staging.beautyboxmarket.com (access code) with beautyboxmarket.com showing "Launching soon". Checked on the live site: the wall on all three addresses, database over verified TLS, the job runner every minute, and a sandbox order paid with a signed, verified pawaPay callback. Launch list closed until the founder opens it. |
| I07 | pawaPay v2 adapter: deposits, status checks, refunds, active configuration, signed callbacks (RFC 9421) and signed requests; production refused outside production (DR-042) | Built, verified against a local imitation, then **run against the pawaPay sandbox** on 2026-10-24 (DR-043): every Rwanda test number through the browser checkout, and the app's payment and refund path in the opt-in `pawapay-sandbox.test.ts` (4/4). The sandbox's refund answers changed two rules (DR-043). Signed requests verified in the sandbox and signed callbacks verified on staging (2026-10-25). On staging, order BB-J2JS-KAWB was refunded in full (RWF 5,100) from the staff order page on 2026-11-01: approved 10:20:33 UTC, sent signed at 10:21:00, pawaPay's refund callback arrived with a verified signature at 10:21:02 and only prompted the status check, which confirmed it; refund SUCCEEDED with no flag, payment REFUNDED, refund case closed. See `docs/integrations/PAWAPAY.md`. |

## API contract

The handoff contract (v1.0.0) is implemented together with documented additions CC-01..CC-20 ([CONTRACT-CHANGES.md](CONTRACT-CHANGES.md)). The machine-readable result is [api/API-Contract-v1.1.openapi.json](api/API-Contract-v1.1.openapi.json). Every implemented operation's real responses are validated against it in `tests/integration/contract.test.ts`; the provider callback is tested separately. Decisions: [DECISION-LOG.md](DECISION-LOG.md) DR-001..DR-045.

## Done on 2026-10-30

- **Raw photo uploads are cleaned up** (DR-046): the job runner deletes raw uploads once no upload URL can still reach them. Needs migration 20261030000000 on staging before the build that uses it is deployed (`npm run staging:bootstrap`, then deploy).
- **Trigger functions have a fixed search path** (DR-047), clearing five warnings from Supabase's security advisor. Same migration.
- **Fresh local set-up runs every test**: `setup:local` now writes `STAFF_AUTH_PROVIDER=test` into `.env.test` (without it, 35 staff tests answered 401 on a new machine), and `npm run typecheck` generates Next.js's type file first, so it passes on a fresh clone.
- **Rate-limit tests no longer flake**: limits count in fixed 10-minute windows, and a test that crossed a window boundary saw its count reset. Those tests now start at the beginning of a window.

## Known gaps and follow-ups
- **Access-reissue SMS wording** is not in the copy drafts; it needs approval with the other templates (B09).
- **No staff tool to value an unvalued supplier obligation** or to close a refund case that turns out not to be owed. Both need a finance procedure first.
- Product weights do not exist yet, so a parcel weight limit can be recorded but is not enforced.
- Staff sessions revoked by a password reset keep working on other devices until their access token expires (one hour by default), because the app verifies staff tokens locally; see the release checklist.
- Staff UI is desktop-first; it has not been tested below 768 px.
- Finalized product photos that are never used on a product stay in private storage; deleting them needs a retention rule.
- Supabase reports 24 foreign keys without their own index (informational). At staging volumes this costs nothing; revisit with real order volumes.

## Supabase advisor findings for the founder (staging project, 2026-10-30)

- `public.rls_auto_enable()` is a `SECURITY DEFINER` function that anyone, signed in or not, can call through the Data API. It is not part of the BeautyBOX code; Supabase creates it when automatic RLS for new tables is switched on. If that setting is not needed, switch it off; otherwise revoke `EXECUTE` on the function from `anon` and `authenticated`. Not changed without your go-ahead.
- Leaked-password protection is off (see the staff account security list in RELEASE-CHECKLIST).

## Open founder inputs
B01-B13 remain outstanding (see the handoff `business/Founder-Inputs.md`). None block local work, and the public sale flow stays closed until they and the release gates pass.

Supabase dev project (checked 2026-10-23): public sign-ups are disabled, the first staff user exists and holds ADMIN, and `SUPABASE_SECRET_KEY` is in `.env.local`. Anonymous sign-ins are off, and the first administrator has signed in with a verified authenticator app. Staff reset their own password from the sign-in page (redirect URL added by the founder); operators can also use `npm run staff:set-password`. Custom SMTP is needed before staff rely on emailed resets.
