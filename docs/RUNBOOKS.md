# Operations runbooks

Draft runbooks for the Phase 1 build (I13). They describe what the software does today and which screens or commands to use. Before launch, the founder must name an owner and contact for each (B-inputs), and these must be rehearsed in staging. Nothing here moves money outside the provider, and no step asks a customer for a PIN.

## Daily checks

1. **Staff overview** (`/staff`): paid orders to prepare, holds, cancellation requests, payments still being checked, payment exceptions, open refund cases, SMS not confirmed sent.
2. **Monitoring probe**: `GET /api/v1/internal/ops-summary` with `Authorization: Bearer <WORKER_SECRET>`. It returns counts and ages only, with no personal data. Alert when `alerts` is non-empty or the probe is not 200. Failures and flags stay on their records, but they alert only for 7 days after they happen, so a handled incident clears and a new one alerts again.
3. **Reconciliation sweep**, daily: `GET /api/v1/internal/reconciliation` (same secret), or `npm run ops:sweep -- --env-file <path>`. These are read-only integrity checks covering stock against the ledger, reservations, commitments, receipts against order payment state, collections without a refund path, and money or messages without an active job. Any non-zero count is a defect to investigate; the sweep never repairs anything.

| Alert | Meaning | Runbook |
| --- | --- | --- |
| `JOB_BACKLOG` | A due background job has waited over 5 minutes | Worker or scheduler stopped |
| `STALE_JOB_LEASES` | A worker died holding a job | Worker or scheduler stopped |
| `JOBS_NEED_REVIEW` | A job stopped automatically | Job needs review |
| `PAYMENTS_UNRESOLVED_LONG` | A deposit has been unresolved for over 2 hours | Payment still unresolved |
| `PAYMENT_EXCEPTIONS` | Mismatch, not found, or needs review | Payment exception |
| `REFUNDS_AWAITING_DECISION` / `REFUNDS_FAILED` | Finance action needed | Refunds |
| `REFUND_AMOUNT_MISMATCH` | The provider confirmed a refund for a different amount | Refunds |
| `REFUNDS_NEED_REVIEW` | The provider's records for a refund differ from ours (refused although within the amount collected, another refund in progress that the app did not send, or a failed refund reported as completed). Alerts until finance closes the review | Refunds |
| `REFUNDS_STUCK` | An approved refund has not finished for over 24 hours | Refunds |
| `STOCK_LEDGER_DRIFT` | A stock lot no longer matches its movement ledger | Stock drift |
| `SMS_NOT_DELIVERED` | A message failed or its outcome is unknown | SMS failure |
| `CANCELLATION_REQUESTS_WAITING` | A customer asked to cancel | Cancellation request |

## Payment still unresolved / "I was debited but the site says pending"

- Never mark an order paid from a screenshot, an SMS from the customer, or a timeout. Only a verified provider status does that.
- On the order (`/staff/orders/<id>`) under Payments, use **Check with provider**. It looks up the **existing** deposit; it never starts a new collection. The result shows in the dialog.
- If the provider still reports pending, checks continue automatically, with backoff and no expiry. Tell the customer not to pay again; the order page says the same.
- If the provider confirms success after the stock was released, the system reallocates the stock or puts the order ON_HOLD and opens a refund case. Follow the hold runbook.

## Payment exception (amount mismatch, not found, needs review)

- Listed at `/staff/finance`. A mismatched amount is held: the order is not fulfilled.
- Compare the provider dashboard with the order total. Resolve with the provider, and refund the collected amount if needed. Record the decision reason in the refund request.

## Paid order on hold

- `HOLD_STOCK_UNAVAILABLE`: payment was verified but the stock could not be allocated. Do not dispatch, and do not substitute without the customer's agreement. Contact the customer, then either cancel (a refund case opens) or resume once stock is genuinely available. **Resume preparation** re-checks payment and full allocation.
- `HOLD_MANUAL`: a staff hold, with the reason in History. Resume or cancel.

## Cancellation request and cancel versus handover

- A customer request is only a request. Decide it before handover: **Cancel order** (stock returns, a refund case opens), or proceed.
- Handover and cancel lock the same order, so only one wins. A stale screen gets "This order changed since you opened it". Reload; never force.
- After handover, the request is declined automatically and support follows the returns policy (B09, pending).

## Refunds

1. Anyone with refund-request rights records a request from a verified payment on the order. The amount cannot exceed what is still refundable.
2. Finance or an admin approves or rejects. Approval reserves the amount and queues a provider refund with a fixed id. Refunds for one payment go to the provider one at a time.
3. **Check refund** looks up the same refund and never sends a second one.
4. A refund counts as complete only after the provider confirms it. A failed refund releases the amount; request again or contact the provider. A failed refund flagged for review does not: follow step 8.
5. A refund the provider confirmed for a **different amount** is recorded as done, flagged, and listed under "Refunds confirmed for a different amount". The customer is not sent an amount. Reconcile it with the provider and settle any difference with a new refund request or a support case.
6. Refunds for one payment go to the provider one at a time. A refund waiting behind another is submitted as soon as that one finishes; it never gives up.
7. Refund only from the order page, never from the pawaPay dashboard: pawaPay processes one refund per payment at a time, and a refund made outside the app is invisible to the app's refundable amount. If pawaPay says another refund is in progress, the app retries the same refund automatically and flags it (step 8). If pawaPay refuses our token, signature or account permission, refunds wait and retry without failing; fix the credentials (`REFUNDS_STUCK` after 24 h).
8. A refund flagged because the provider's records differ is listed under "Refunds where the provider's records differ" (`REFUNDS_NEED_REVIEW`): refused although within the amount collected ("already refunded", more than pawaPay says is left), sent while pawaPay was processing a refund the app did not send, or reported as completed after it was recorded as failed. Its amount stays reserved and a failed one shows to the customer as under review. On the order, find the payment in the pawaPay dashboard by its **provider id** and compare every refund there with the order's refunds (each shows its provider id). Then close the review on the refund. For a failed refund: **Records match** only when the dashboard shows no refund of this payment by any other route (its amount becomes refundable again); **Paid by provider** when the customer got money back anyway, this refund after all or a refund made in the dashboard (give the amount paid back and the provider's reference). For a refund flagged because pawaPay was processing another one: **Records match** when that other refund is a separate one; if it duplicates this refund, do not close the review and escalate to the founder. All are audited; closing a review never sends money.

## Stock drift

- `STOCK_LEDGER_DRIFT` or a sweep `*_DRIFT` count means a lot's quantities no longer match its ledger, reservations or allocations. Stop adjusting that lot, export the lot's movements and the sweep sample ids, and correct it with a reasoned adjustment once the cause is known. Never edit lot quantities directly in the database.

## SMS failure, or a customer lost their link

- A definite provider failure is retried 3 times, then left FAILED and flagged. An unknown outcome is never resent. The order stays valid and visible.
- Verify the customer outside the system: match the order reference and the contact details on the order. Never reveal order details first. Record a case reference.
- **Send a new private link** revokes every earlier link and order session, then texts a fresh one-time link to the order's contact number. Staff never see the link.
- If the contact number itself is wrong, there is no edit tool yet. Escalate to an admin.

## Product photos: takedown and storage problems (DR-041)

- **A photo must come down** (rights complaint, wrong product): remove it from the product at `/staff/catalog/<id>`, or untick image rights, and save. For an archived product its photos are already withdrawn; archiving a product withdraws all of them. The public copy is deleted at once, but the CDN and browsers can keep showing it for up to 10 minutes. The original stays in the private bucket for the record.
- **Publishing says the photos could not be made public**: Supabase Storage is unreachable or refused the copy. Nothing was published; try again shortly. Check the Supabase status page and that `SUPABASE_SECRET_KEY` is still valid.
- **A saved photo is missing on the shop**: its public copy is applied right after the save; if storage failed at that moment, a `MEDIA_PUBLIC_SYNC` job retries with backoff. Jobs that keep failing show as `JOBS_NEED_REVIEW`. Never copy files into the public bucket by hand: the job decides from the photo's review state.
- **Uploads fail in the browser**: the upload goes straight to Supabase Storage. The bucket refuses files over 10 MB and types other than JPEG, PNG or WebP; the server then decodes and re-encodes every photo.

## Failed delivery attempt

- **Record failed attempt** with who has the goods (rider, BeautyBOX, recipient). The customer gets a "we need to contact you" SMS. Agree a reattempt or return under the delivery policy (B09).

## Worker or scheduler stopped (job backlog, stale leases)

- Production: check the Supabase Cron job that calls `POST /api/v1/internal/jobs/run`, and its secret. Locally: `npm run worker`.
- Leases expire after 60 s and jobs are reclaimed automatically. A provider call that may have happened is looked up before any resend.
- Payment and refund status checks never give up. Other jobs stop after repeated failures and show as `JOBS_NEED_REVIEW`.

## Job needs review

- Find it in `commerce.outbox_jobs` (state `NEEDS_REVIEW`, `last_error_code`). Common codes: `SEND_OUTCOME_UNKNOWN` (an SMS might have gone; check with the customer before resending), `SMS_FAILED_*`, `NOT_INITIATED_BEFORE_EXPIRY` (a deposit was never accepted; finance checks with the provider).
- Do not edit money rows by hand. Use the staff tools, and record reasons.

## Provider or routing outage: pause paid checkout

**Primary:** an administrator unticks **Checkout open** at `/staff/settings`, gives a reason and saves. That writes a new settings version and takes effect on the next payment start.

**Fallback, when the staff workspace is unavailable:** run the script against an explicit environment file. It prints the target (APP_ENV, deployment profile, database host) before writing, and refuses a local development database unless `--local` is passed.

```bash
npm run ops:checkout -- pause --env-file <path-to-environment-file> --reason "pawaPay outage, incident <ref>"
```

Pausing stops new payment starts at once. Carts stay, and unresolved payments keep being checked. Each switch writes a new settings version and an audit event. Resuming never bypasses the release gates.

## Staff joining or leaving

- Joining: create the user in Supabase Auth (public sign-ups disabled), grant the role, set a first password with `npm run staff:set-password -- --email <email> --reason "<why>"` (typed by the person at a hidden prompt; audited), then they sign in at `/staff/sign-in` and enrol an authenticator app in the same sitting (until they do, anyone with access to their mailbox could reset the password and enrol their own authenticator). Forgotten password: the person uses "Forgotten your password?" on the sign-in page (an emailed one-time link, opened in the same browser; accounts with two-step verification also enter an authenticator code), or an operator runs the same command. Do not use the dashboard's "Send password recovery": its links do not return to the reset page. Lost authenticator: after verifying the person outside the system, an administrator removes their TOTP factor with Supabase's admin API (`auth.admin.mfa.deleteFactor`, secret key, server-side only; there is no BeautyBOX command for this yet); they enrol a new authenticator at next sign-in. `npm run staff:grant` uses `.env.local`. For a hosted environment run `npx tsx --conditions=react-server --env-file=<path> scripts/staff/grant.ts ...` against that environment's file.
- Leaving: an admin sets **Disabled** at `/staff/team` (effective on their next request), then deletes or blocks the user in Supabase Auth. The last active admin cannot be removed.

## Backup, restore and rollback (T20)

- Drill: `npm run ops:drill -- --source beautybox_dev`. It runs pg_dump and copies media, restores into a scratch database, then compares row counts, migrations, constraints, indexes, triggers, pending jobs, ledger reconciliation, runtime grants and `prisma migrate status`. The report is written to `.local/backups/<source>-<time>/drill-report.json`.
- Hosted: confirm the plan's database backup and point-in-time recovery, and back up Storage objects separately (database backups do not include media). Rehearse a restore into a separate project and record the measured time.
- Rollback: never run a down-migration on production data. Pending jobs stay in `outbox_jobs` and resume.
  - A build can be rolled back by redeploying the previous one only if every migration since then is **additive**: new tables, nullable columns, new indexes, and enum values the old build never reads.
  - **Not additive (no build has been deployed with these yet):**
    - `20261022000000_operations_notifications` renames `customer_operations` to `operations`, replaces a notifications unique index and adds enum values.
    - `20261023000000_review_fixes` adds the `VOID` settlement state.
    - A build from before either migration cannot run against the migrated schema.
  - From the first production deployment on, follow the release checklist rule: any rename, drop or type change ships expand/contract across two releases (add, dual-use, then remove). The rollback plan for each release must name the last compatible build.
  - If an incompatible release must be backed out, fix forward: restore service with a corrective build on the new schema, or restore the pre-release backup (and accept the data loss window) only if the founder approves.

## Secrets

| Secret | Rotation effect |
| --- | --- |
| `WORKER_SECRET` | Update the scheduler and monitor at the same time. |
| `SUPABASE_SECRET_KEY` | Server-only; photo storage and `staff:set-password` use it. Rotate in Supabase (API keys) and the deployment environment together; uploads, publishing and photo previews fail until both match. |
| `TOKEN_HASH_SECRET` | All guest sessions, order sessions, private links and rate-limit keys stop matching. Customers keep their orders but need support to reissue links. Rotate only in an incident. |
| `SITE_ACCESS_CODE_HASH` (pre-launch access code, DR-044) | Signs every visitor out of the preview; staff sign-in is separate and unaffected. Set a new code with `npm run staging:access-code`, push the settings, redeploy. Change it when someone who had it should no longer see the preview. |
| Database runtime password (`DATABASE_URL`, role `beautybox_app`) | Delete `STAGING_RUNTIME_DB_PASSWORD` and `DATABASE_URL` from the settings file, run `npm run staging:bootstrap` (sets a new password), push the settings, redeploy. The site cannot reach the database between the password change and the redeploy. |
| `DATA_ENCRYPTION_KEY` | Encrypts payer numbers and callback evidence. No re-encryption tool exists yet: do not rotate without one (I13 follow-up). |
| Provider keys (pawaPay, SMS, Google) | Rotate in the provider console and the deployment environment together. Callbacks with an unknown key are stored as unverified and never mark anything paid. |
| pawaPay request-signing key (`PAWAPAY_SIGNING_PRIVATE_KEY`, `PAWAPAY_SIGNING_KEY_ID`) | Add the new public key in the pawaPay dashboard first, deploy the new private key and id, then remove the old key. (Sandbox on a developer machine: `scripts/ops/pawapay-signing-key.ts generate`, upload `public.pem`, then `install --key-id <id>`.) With "Only accept signed requests" on, a mismatch makes every payment start fail as refused (`HTTP_SIGNATURE_ERROR`). pawaPay's own callback keys rotate on their side; the app refreshes them automatically (at most once a minute). |

## Pre-launch wall and launch list (DR-044, DR-045)

- **Someone with the access code should no longer have it**: change the code (Secrets table above).
- **The main domain shows the shop, or staging shows it without the code**: check `SITE_GATE=on` and `HOLDING_HOSTS` in the Vercel settings, then redeploy. If the wall's settings are missing or malformed it fails closed (everything shows "Launching soon"; staff and callbacks still work).
- **Removal request from the launch list** (e-mail or SMS to the contact address): `npm run launch-list -- remove`, type the e-mail address or number at the prompt (as the mail client shows it is fine), then reply that it is done. An e-mail and a number typed together in one sign-up are removed together. If the person added a detail in a later sign-up, the script lists it as "typed together with it in another sign-up" and asks: type `yes` only if the person confirms it is theirs (it can be a phone shared with someone else). "Not on the list" means the detail was read and looked up; something unreadable is refused with a message instead.
- **Access or correction request**: `npm run launch-list -- find` shows what is held for that detail and any detail typed with it in another sign-up (confirm those are theirs before sharing them); answer them. For a correction, remove the old detail and ask them to sign up again.
- **Retention** is automatic: every job-runner run (once a minute) deletes sign-ups 12 months after the latest consent, and spent rate-limit counters.
- **After the launch message is sent**: delete the list with `npm run launch-list -- purge --all --yes`, and delete every export.

## Suspected data exposure

1. Pause checkout if payments could be affected.
2. Reissue links for affected orders (this revokes sessions), disable affected staff, and rotate the exposed secrets.
3. Preserve the audit trail (`audit_events` is append-only) and request ids from logs, which are redacted.
4. Follow the privacy incident duties confirmed with the qualified reviewer (G2). This document does not define them.
