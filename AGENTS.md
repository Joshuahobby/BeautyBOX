# BeautyBOX: instructions for coding agents

BeautyBOX Phase 1 is a Rwanda beauty shop: guest checkout, RWF, pawaPay mobile money and Kigali delivery from one shop. The founder decides scope and release. Agents implement, verify and keep the documentation true.

## Start here

1. Read **`docs/PROGRESS.md`, section "Where Phase 1 stands"**: the current state, what is live, what blocks launch (with owners) and **the next actions**. Treat it as the source of truth for status.
2. Then read as needed:
   - `docs/RELEASE-CHECKLIST.md`: the launch gates G0–G5.
   - `docs/DECISION-LOG.md`: decisions DR-001 onward. A founder decision recorded there overrides older baseline documents.
   - `docs/CONTRACT-CHANGES.md` and `docs/api/API-Contract-v1.2.openapi.json`: the API.
   - `docs/DEPLOYMENT.md`: staging operations.
   - `docs/TEST-EVIDENCE.md`: what has actually been run.
   - `docs/SETUP.md`: local set-up.
   - `docs/integrations/`: pawaPay, Google, Africa's Talking.
3. The original handoff package (`BeautyBOX-Handoff-v1.0`) is not in Git. The pinned contract baseline in `docs/api/baseline/` replaces it for the API (DR-053). If a copy of the package exists next to the repository, it is read-only reference.

## Keep the documentation current, in the same PR as the change

- **`docs/PROGRESS.md`:** update the dated "Where Phase 1 stands" section (status table, blockers, next actions) whenever the state changes.
- **`docs/DECISION-LOG.md`:** one row per decision, in the existing table format. The next free number is in the "Numbering" line below.
- **API changes:** add them in `scripts/contract/build-contract.mjs`, then regenerate (`node scripts/contract/build-contract.mjs`; `npm run contract:check` must pass), and describe them in `docs/CONTRACT-CHANGES.md`.
- **`docs/TEST-EVIDENCE.md`:** add a dated entry with the source commit, the commands run and their results, and **what was not run, and why**. Never present a skipped or mocked check as passed.
- **`docs/RELEASE-CHECKLIST.md`:** update a gate's row when its status changes.
- **A new migration:** list it in the RELEASE-CHECKLIST migration item and in the staging steps of `docs/DEPLOYMENT.md`.
- **Wording:** plain English. Write dates as absolute dates (for example "24 November 2026"), never "today".
- **Numbering:** the next decision is **DR-065**. DR-048 and DR-049 are reserved for PR #3. The next contract change is **CC-26**; CC-23 is reserved for PR #3.

## Safety rules

- **Data and providers:**
  - Synthetic data only, in every environment, until gate G2 passes.
  - pawaPay **sandbox** only. Never call production pawaPay or move real money.
  - No real SMS; SMS is a phase after launch (DR-057).
  - Real e-mail goes only from staging, and only to addresses the founder controls.
- **Secrets** live only in `.env.local` and `.env.staging.local`, which the founder holds and which are ignored by Git.
  - Never put a secret in Git, chat, logs, PR text or commit messages.
  - To check that a key is present, test its pattern; never print it.
  - The founder creates and pastes keys themselves.
- **Merging to `main` deploys staging** (Vercel production target = `staging.beautyboxmarket.com`).
  - Apply a branch's new migration to staging **before** merging, with `npm run staging:bootstrap`.
  - Run it from a checkout of that branch: it applies **every** migration in the folder. So never run it from a branch with unmerged migrations, such as PR #3's `20261101000000`.
  - After a deploy, confirm the live build with the `X-Beautybox-Revision` header.
- **Staging settings:**
  - Before `npm run staging:env-push -- --target production`, validate `.env.staging.local` by loading `serverEnv()` with that file. A setting that fails validation stops staging from starting.
  - Then redeploy: `npx vercel redeploy https://staging.beautyboxmarket.com --target production`.
- **Hosted operating settings** change only through Staff → Settings, which versions and audits them. The one direct SQL change so far (staging settings version 2, DR-060) was founder-approved. Do not repeat it without approval.
- **Founder decisions:** never open public checkout or live payments, open the launch list, switch off the access wall, or create production resources without the founder's explicit decision (RELEASE-CHECKLIST G5).
- **Pull requests:**
  - CI ("Build, data and browser checks") runs only on PRs into `main`.
  - Keep PRs as drafts until CI passes, then merge with **Create a merge commit**.
  - Browser tests must assert on visible elements, `.filter({ visible: true })`: React streaming briefly renders hidden duplicates, which caused CI flakes in runs 45151009162, 45291924231 and 45362920532.

## Repository freshness

- Before reviewing the product, choosing implementation changes, or starting a new task, check the working tree and fetch the latest GitHub refs. Compare the local commit with the intended upstream branch (normally `origin/main`).
- Preserve local work. Fast-forward an outdated clean baseline when appropriate; if branches diverge or local changes overlap, reconcile them without discarding work. Do not review an old local checkout as though it were the current product.
- Record the source commit used for builds, screenshots, reviews and verification. Check upstream again before final handoff if work has continued while the task was in progress.
- Treat GitHub source and a deployed site's version as separate facts. Do not claim deployment parity without evidence for the deployed commit. When live-site access is unavailable, use the latest GitHub source locally and state that limit instead of reverting to an older implementation.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
