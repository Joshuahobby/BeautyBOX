# Staging deployment on beautyboxmarket.com (DR-044)

What this sets up, at no cost until launch:

| Address | What visitors see |
| --- | --- |
| `beautyboxmarket.com`, `www.beautyboxmarket.com` | Only "BeautyBOX is launching soon", its privacy notice and (once opened) the launch-list sign-up. Every other path goes back to `/`. |
| `staging.beautyboxmarket.com` | "Launching soon" until the access code is entered at `/access`; then the whole shop in staging mode: pawaPay **sandbox** (no real money), simulated delivery distances, no SMS, the synthetic demo catalogue. Staff sign in at `/staff` with their password and authenticator app. |
| `*.vercel.app` addresses of the project | Vercel's own sign-in (Standard Protection), then the same as staging. |

Not set up here: production (`APP_ENV=production`, live pawaPay, real routing and SMS). That is a separate environment, prepared at launch together with the Vercel Pro plan. Public launch stays a separate founder decision (RELEASE-CHECKLIST).

Services and plans:

- **Vercel Hobby** (free). Its terms allow personal, non-commercial use: fine while nothing is sold; move the same account to Pro before the shop takes real orders. Functions run in `dub1` (Dublin), next to the database (`vercel.json`).
- **Supabase Free**: the existing project "BeautyBOX Web App" (eu-west-1) becomes the staging project. Local development keeps its own PostgreSQL on this machine; staff sign-in and photo storage for local development keep using the same Supabase project. Free projects pause after about a week without use: restore it from the dashboard if that happens.
- **Cloudflare**: DNS for the domain, records set to "DNS only" so Vercel can issue the certificates.
- **GitHub**: private repository `Joshuahobby/BeautyBOX`; every push to `main` deploys.

Never needed here, never stored in Vercel: the Supabase database password (owner connection), pawaPay production credentials.

## 1. Code on GitHub

The repository is pushed from this folder (`beautybox-app`) to `Joshuahobby/BeautyBOX`, branch `main`. Settings files (every `.env*` except the two templates), `.local/`, `.vercel/` and build output are ignored by Git (`.gitignore`) and by Vercel uploads (`.vercelignore`). Commits are authored as the GitHub account, which Vercel's Hobby plan requires for private repositories.

## 2. The staging settings file

On this machine, in this folder:

1. Copy `.env.staging.example` to `.env.staging.local` (never committed or uploaded), set `STAGING_OWNER_DATABASE_URL` to the **Session pooler** address from Supabase → **Connect**, without the password (user `postgres.<project-ref>`, port 5432; for this project `postgresql://postgres.nhvkszbbqiqtbtbuewyw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`), then fill in the rest with `npm run staging:bootstrap -- --prepare --copy-from .env.local`. That copies the pawaPay sandbox token and signing key and the Supabase keys from `.env.local`, generates the staging-only secrets, writes `DATABASE_URL`, and lists what is still missing. (Done on 2026-10-25.) The scripts limit the file to your Windows account. Once it is complete, keep a copy in your password manager: `DATA_ENCRYPTION_KEY` cannot be read back from Vercel, and without it the encrypted launch list and payer numbers cannot be read. Your existing `.env.local` (local development, with the shared Supabase secret key and the pawaPay sandbox token) keeps the folder's permissions, which let other local Windows accounts read it; to limit it to your account, run `icacls .env.local /inheritance:r /grant:r "%USERNAME%:F" "*S-1-5-18:F"` in Command Prompt (tools that run under other accounts, such as a sandboxed coding assistant, then cannot read it).
2. **Database password.** The set-up in step 5 asks for it at a hidden prompt and saves it in the file (it is only for the set-up scripts and never sent to Vercel). If you don't know it, reset it under Supabase → **Database → Settings**; nothing else uses it.
3. **Database certificate.** Supabase → **Database → Settings → SSL Configuration → Download certificate**. Step 5 stores it for you with `--ca-file`.
4. **Access code.** Choose a code (at least 10 characters) and type it twice at the hidden prompt; only a scrypt verifier is stored:

   ```bash
   npm run staging:access-code
   ```

5. Run the set-up in a terminal (it asks for the database password, stores the certificate, prepares the database and adds the synthetic demo shop):

   ```bash
   npm run staging:bootstrap -- --ca-file "$HOME/Downloads/prod-ca-2021.crt" --seed
   ```

   It prints names and counts only. It refuses to copy pawaPay credentials unless `.env.local` says `PAWAPAY_MODE=sandbox`, refuses a Supabase URL from a different project than the database, and refuses the transaction-pooler port for the owner connection. Safe to run again.

6. **Staff access in the staging database.** Your Supabase sign-in already exists (same project); grant it a role in the new database, with the user id from Supabase → Authentication → Users:

   ```bash
   npm run staging:staff-grant -- --auth-user-id <uuid> --email <email> --name "<display name>" --role ADMIN --reason "Staging administrator"
   ```

## 3. Vercel project

1. `vercel login` (once; sign in with GitHub as `Joshuahobby`).
2. In this folder: `vercel link` → create a new project named `beautybox` in your personal (Hobby) scope, directory `./`. This creates `.vercel/project.json` (ignored by Git).
3. Send the settings (production environment of this project = the staging site). Secrets are stored as Vercel "Secret" values; owner credentials are never sent:

   ```bash
   npm run staging:env-push -- --target production
   ```

   Add `--dry-run` first to see the names and lengths that would be sent.
4. Vercel dashboard → the project → **Settings → Git → Connect Git Repository** → GitHub → `Joshuahobby/BeautyBOX` (allow the Vercel GitHub app on that repository). Production branch: `main`.
5. **Settings → Build and Deployment**: Framework Next.js, Node.js 22.x. **Settings → Deployment Protection**: keep Standard Protection.
6. Deploy: **Deployments → Redeploy** (or push to `main`). Settings changes apply only to new deployments.

Branch (preview) deployments get no settings and will not run; that is intended.

## 4. Domains and DNS

1. Vercel → the project → **Settings → Domains**: add `staging.beautyboxmarket.com`, `beautyboxmarket.com` and `www.beautyboxmarket.com`. Let `www` redirect to `beautyboxmarket.com` (either way works: both only show "Launching soon").
2. Cloudflare → `beautyboxmarket.com` → **DNS → Records**: create the records exactly as Vercel's Domains page shows them (typically an `A` record for `@` and `CNAME` records for `www` and `staging`), each with **Proxy status: DNS only** (grey cloud). Replace any existing `A`, `AAAA` or `CNAME` record for `@`, `www` or `staging`; leave `MX` and `TXT` records (e-mail) alone. If there is a `CAA` record, it must allow `letsencrypt.org`.
3. Wait until Vercel shows each domain as valid with a certificate (minutes, sometimes an hour).

## 5. Supabase and pawaPay settings for the staging address

- Supabase → **Authentication → URL Configuration → Redirect URLs**: add `https://staging.beautyboxmarket.com/staff/reset-password` (keep the localhost one for local development). The Site URL can stay as it is.
- pawaPay **sandbox** dashboard → callback URLs for deposits and refunds: `https://staging.beautyboxmarket.com/api/v1/callbacks/pawapay`. Callbacks only prompt a status check; payments are still counted only from pawaPay's own status answer.
- **Scheduler** (once the staging address answers): every minute Supabase Cron calls the job runner with the worker secret kept in Supabase Vault:

  ```bash
  npm run staging:bootstrap -- --scheduler
  ```

  Check: Supabase → **Integrations → Cron** shows `beautybox-jobs-run` succeeding; the staff Operations page shows recent job runs.
- **SMS (optional, sandbox only, DR-048)**: in `.env.staging.local` set `SMS_PROVIDER=africastalking`, `AFRICASTALKING_USERNAME=sandbox` and the sandbox API key. For delivery reports run `npm run sms:callback-token -- --env-file .env.staging.local` and paste the copied address in the Africa's Talking **sandbox** dashboard under SMS → SMS Callback URLs → Delivery Reports. Push the settings and redeploy. Messages then appear only in Africa's Talking's simulator; a live account is refused on staging.

## 6. Check before sharing the code

- `https://beautyboxmarket.com` and `www` show "Launching soon"; `https://beautyboxmarket.com/shop` returns to `/`.
- `https://staging.beautyboxmarket.com/shop` shows "Launching soon" without the code; after the code at `/access`, the shop.
- Staff sign-in with the authenticator at `https://staging.beautyboxmarket.com/staff`; the password-reset e-mail link opens the staging page.
- A sandbox order end to end with pawaPay's sandbox test numbers, and a refund (finance page).
- A product photo upload and approval.
- Not indexed: `https://beautyboxmarket.com/robots.txt` disallows everything.

## Opening the launch list (founder decision, DR-045)

The sign-up form stays hidden until all of these are done:

1. Read and approve the notice at `/launch-privacy` (`src/content/launch-privacy.ts`).
2. Choose the contact address shown in it and in the confirmation message (for example `hello@beautyboxmarket.com`, once that mailbox works).
3. Confirm with your adviser what Rwanda's data-protection law (Law No 058/2021) requires before collecting: registration with NCSA as a controller, and authorization for storing the details outside Rwanda (the database is in Ireland).

Then in `.env.staging.local` set `LAUNCH_LIST=open` and `LAUNCH_LIST_CONTACT_EMAIL=<address>`, run `npm run staging:env-push -- --target production` and redeploy.

Working with the list (it holds personal data; run on this machine only):

```bash
npm run launch-list -- count
```

`find` and `remove` ask for the e-mail address or number at a prompt (never on the command line, which npm logs keep) for access and removal requests; `export` writes a CSV under `.local/` that only your Windows account can open (delete it once the launch message is sent); `purge --all --yes` deletes the list once the launch message is sent. The 12-month limit is applied automatically by the job runner (every minute). Before any launch SMS, name the SMS provider in the notice.

## Routine changes

- **New code**: push to `main`. Database changes (new migrations) are applied from this machine first: `npm run staging:bootstrap` (it runs `prisma migrate deploy` as the owner), then push. Merging a pull request to `main` deploys too, so apply its migrations before merging (for example 20261101000000 for the SMS delivery columns).
- **Change the access code** (signs everyone out): `npm run staging:access-code`, `npm run staging:env-push -- --target production`, redeploy.
- **Turn the wall off or on**: `SITE_GATE` in the file, push, redeploy. Keep it on until launch.
- **Undo a bad deployment**: Vercel → Deployments → the previous one → **Instant Rollback**.
- **Take the site down**: Vercel → Settings → Domains → remove the domains (or pause the project).
