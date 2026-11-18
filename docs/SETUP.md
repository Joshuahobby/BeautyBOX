# Local setup and review path

Everything below runs locally with synthetic data and simulated providers. Nothing contacts pawaPay, Google, an SMS provider or a production database. To try the real pawaPay adapter, use a pawaPay **sandbox** account (`PAYMENT_PROVIDER=pawapay`, `PAWAPAY_MODE=sandbox`, sandbox token); production pawaPay is refused unless `APP_ENV=production` (`docs/integrations/PAWAPAY.md`).

## Prerequisites

- Node.js 22.12+ (22.23.1 tested) and npm 10.
- PostgreSQL server binaries 15+ (16.15 tested). Set `PG_BIN` if they are not in `C:\Program Files\PostgreSQL\16\bin`. Docker is not required.
- Playwright Chromium headless shell for browser tests: `npx playwright install --only-shell chromium`.

## First run

```bash
npm install
```

```bash
npm run setup:local
```

`setup:local` does the following:

1. Creates a **project-local** PostgreSQL cluster in `.local/postgres` on 127.0.0.1:54329, with roles `bb_owner` (migrations) and `bb_app` (runtime). It never touches a system PostgreSQL service.
2. Writes `.env.local` and `.env.test` with freshly generated local-only secrets. Keep these files private: never commit them.
3. Bootstraps the runtime group role, applies the migrations, creates the simulated payment provider schema (`devsim`) and the deployment profile.
4. Seeds the **demo catalog** into `beautybox_dev`.

Start from empty again with `npm run setup:local -- --reset`.

## Run the shop

```bash
npm run dev
```

Open http://localhost:3000. Optionally run the durable job worker in a second terminal. Without it, background jobs only advance when a page triggers them, for example while a payment page is polling.

```bash
npm run worker
```

### Review the purchase path

1. Open a product, for example **Lip Hue**. Choose a shade (the add button stays disabled until you do) and add it to the cart.
2. In the cart, choose **Continue to checkout** and enter a recipient name and a Rwanda mobile number, for example `0788 555 111`.
3. Search a demo place (`Kimironko`, `Nyabugogo`, `Kicukiro`), or use the arrow controls to adjust the pin. Then choose **Confirm pin and get fee**. Searching `Musanze` shows the out-of-coverage state, and the test fixtures `exactly 3.0 km`, `3.1 km` and `5.0 km` show the tariff boundaries.
4. Accept the fee, choose a network and pay. The last three digits of the paying number pick the simulated outcome:
   - any other ending: succeeds after about 4 s
   - `001`: verified failure
   - `002`: never settles (unresolved)
   - `003`: rejected at initiation
   - `004`: response lost, then succeeds
   - `006`: amount mismatch, held for finance review
   - `007`: succeeds after about 45 s
5. The payment page shows pending, still-checking or failed states from the server only. A verified success opens the private order page. Try opening that URL in a private window: it reveals nothing.

### Review private order links and SMS

Nothing is sent to a phone locally. With `SMS_PROVIDER=fake`, every message lands in a simulated inbox at http://localhost:3000/dev/sms (this page returns 404 in any other configuration). Run `npm run worker` so messages go out promptly.

1. After a verified payment, open `/dev/sms` in a private window and follow the link in the "Payment received" message. It opens the order once and removes the token from the address bar.
2. Open the same link in another private window: it is refused with a support path. Opening it again in the window that already used it simply continues to the order.
3. On the buyer's order page, **Open this order on another device** creates a one-time link (shown once).
4. A delivery phone ending in `0999` makes the simulated SMS provider reject messages (retried 3 times, then flagged to staff); `0998` simulates a lost response (never resent). The order stays paid and visible either way.
5. **Ask to cancel this order** records a request; staff decide it from the order screen.

### Review the staff workspace

Staff sign-in uses the Supabase dev project (`STAFF_AUTH_PROVIDER=supabase` in `.env.local`), with MFA required:

1. In the Supabase dashboard, disable public sign-ups and add a user for yourself (Authentication → Users).
2. Sign in at http://localhost:3000/staff/sign-in and enrol an authenticator app when asked.
3. Grant a role to that user (its id is on the Supabase user page):
   ```bash
   npm run staff:grant -- --auth-user-id <uuid> --email <you@example.com> --name "<Your name>" --role ADMIN --reason "Initial administrator"
   ```
4. Reload `/staff`. Orders: prepare → assign rider → record handover → confirm delivery, or hold/resume/cancel; every step asks for a reason and refuses a stale screen. Payments & refunds: exceptions, refunds awaiting a decision and open refund cases; approve/reject refunds and "check with provider" from the order page.

Browser tests use a test-only identity header instead (accepted only when `APP_ENV=test`).

## Quality checks

```bash
npm run verify
```

This runs the token freshness check, typecheck, lint and unit tests.

```bash
npm run test:integration
```

Integration tests run against the real local PostgreSQL test database.

```bash
npm run test:e2e
```

Browser tests start their own server on port 3100 against the test database. Stop `npm run dev` first on low-memory machines. Screenshots are written to `test-results/screens`.

The readiness workflow at `.github/workflows/quality.yml` runs these checks on PRs to `main`, using Node 22, locked dependencies, PostgreSQL 16 and Chromium. Setup generates isolated LOCAL/TEST settings; no hosted secret is required. Database integration and browser suites must run sequentially because both reset `beautybox_test`. `npm run audit:optional` reports external prerequisites without making provider requests.

If this environment blocks Playwright's download but has compatible system Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` for local browser checks and evidence scripts. CI retains the Playwright-pinned browser. Record the actual browser version with evidence.

`npm run images:generate` derives the checked-in responsive variants; `npm run images:check` verifies all source/variant hashes and is included in `verify`. Start the isolated production TEST preview before `npm run capture:readiness` or `npm run perf:mobile -- before` / `after`. The performance protocol is fixed in the script; compare separate clean-baseline and feature builds with fresh identical demo fixtures, sequentially. Curated PNG/JSON evidence is committed under `docs/evidence/readiness/`; raw Playwright traces stay ignored.

## Environment variables

See `.env.example` for every variable. Staging uses `.env.staging.example` and the steps in [DEPLOYMENT.md](DEPLOYMENT.md); it refuses local photo storage, the payment simulator and the SMS simulator, and requires TLS to the database. Production refuses fake adapters, a visible demo catalog, a non-https origin and missing provider secrets (`src/server/env.ts`). Checkout additionally stays closed in production while any publication block exists: tariff, origin, policies, support contact, delivery promise, live payments or live routing (`src/modules/settings/settings.ts`).

## Supabase (dev project)

The founder's dev project "BeautyBOX Web App" is used for staff Auth/MFA and Storage from I08 onward. Put `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` into `.env.local` yourself. `SUPABASE_SECRET_KEY` is server-only: the server uses it for photo storage (`MEDIA_STORAGE=supabase`) and the operator command `npm run staff:set-password` uses it. It must never carry a `NEXT_PUBLIC_` prefix (those values are built into browser code). Photos: set `MEDIA_STORAGE=supabase` to keep them in the dev project's `private-media` and `product-photos` buckets (DR-041); `local` keeps them under `.local/media/`. For staff password resets, add `<origin>/staff/reset-password` to Authentication → URL Configuration → Redirect URLs. Never paste secrets into chat or commit them. Use synthetic data only until gate G2 (privacy/hosting review) passes.
