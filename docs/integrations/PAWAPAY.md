# pawaPay integration (I07, DR-042, DR-043)

Built against the pawaPay Merchant API v2 public documentation (docs.pawapay.io/v2, reviewed 2026-10-24), then run against the **pawaPay sandbox** on 2026-10-24 with the founder's sandbox token (see "Sandbox evidence" below). Live payments are outside this build's authorization and have not been made. The local imitation (`tests/support/pawapay-mock.ts`) now answers the way the sandbox did.

## What the adapter does (`src/adapters/payments/pawapay.ts`)

| Need | pawaPay v2 | Adapter behaviour |
| --- | --- | --- |
| Which methods can customers use | `GET /v2/active-conf?country=RWA&operationType=DEPOSIT` | MTN_MOMO_RWA and AIRTEL_RWA that are configured for RWF deposits and not `CLOSED`, intersected with the approved allowlist; unreadable configuration = checkout shows methods as temporarily unavailable |
| Collect | `POST /v2/deposits` with our persisted `depositId`, amount as a whole-RWF string, `payer.accountDetails` (MSISDN, provider), `clientReferenceId` (order reference), `customerMessage` (4-22 letters, digits, spaces) | `ACCEPTED`/`DUPLICATE_IGNORED` = accepted (never paid); `REJECTED` (HTTP 200, or 400/401/403 with status REJECTED) with a specific code = definitive refusal with that code; `REJECTED` with `UNKNOWN_ERROR` or no code = unknown (pawaPay: not safe to assume it failed); HTTP 5xx, other statuses, timeouts (15 s) and network errors = **unknown**: the app looks the same id up and never sends a new id |
| Payment result | `GET /v2/deposits/{depositId}` | answers about any other id are ignored (unknown); `FOUND` + `COMPLETED` = paid (amount parsed from e.g. `"100.00"`; any fraction = mismatch for finance); `FAILED` = failed with pawaPay's code; `ACCEPTED`/`PROCESSING`/`IN_RECONCILIATION` = still pending; `NOT_FOUND` = never reached pawaPay |
| Refund | `POST /v2/refunds` with our persisted `refundId`, `depositId`, explicit amount and currency | as deposits, with refusals read in three groups (DR-043). "Try again later" (looked up, then re-sent under the same id): a refund already in progress for the deposit (the sandbox answers `INVALID_STATE` "A refund is already in progress for this deposit."; the docs name `REFUND_IN_PROGRESS`; flagged for finance, since the app sends one refund per payment at a time), `PROVIDER_TEMPORARILY_UNAVAILABLE`, and our access problems (`AUTHENTICATION_ERROR`, `AUTHORISATION_ERROR`, `NO_AUTHENTICATION`, `HTTP_SIGNATURE_ERROR`, `REFUNDS_NOT_ALLOWED`). "Records disagree" (`INVALID_AMOUNT` for more than is left, `INVALID_STATE` "already refunded", `DEPOSIT_NOT_COMPLETED`, `DEPOSIT_NOT_FOUND`, `NOT_FOUND`): failed, flagged `NEEDS_REVIEW`, amount kept reserved until finance closes the review. Any other refusal: failed. A failed outcome for a refund that a verified callback called completed is flagged too, whatever the order |
| Refund result | `GET /v2/refunds/{refundId}` | `COMPLETED`/`FAILED` final; `ACCEPTED`/`ENQUEUED`/`PROCESSING`/`IN_RECONCILIATION` pending. A completed refund whose amount or currency differs from what was sent (including a fraction) is recorded as done, flagged for finance, and the customer is not told an amount. A signed "completed" callback for a refund recorded as failed is flagged for finance |
| Callbacks | signed with pawaPay's key (RFC 9421, label `sig-pp`, `Content-Digest` over the exact body), keys from `GET /v2/public-key/http` | verified signature, digest, covered components (method, authority, path, digest) and freshness (5 min); unknown key ids trigger a key refresh at most once a minute. Even a verified callback only prompts the status check above; unverified ones are recorded and answered 401 |
| Signed requests | optional, enforced when the dashboard's "Only accept signed requests" is on | when `PAWAPAY_SIGNING_PRIVATE_KEY` and `PAWAPAY_SIGNING_KEY_ID` are set, deposits and refunds carry `Content-Digest`, `Signature-Date`, `Signature-Input` and `Signature` (ECDSA P-256/P-384 or RSA-PSS) |

Rejections are read from `failureReason.failureCode` and, as the refunds guide also shows, `rejectionReason.rejectionCode`. Responses over 1 MB are treated as unknown. pawaPay's `failureMessage` is for operators only and is never shown to customers.

## Configuration

| Variable | Meaning |
| --- | --- |
| `PAYMENT_PROVIDER=pawapay` | Use pawaPay instead of the simulator |
| `PAWAPAY_MODE` | `sandbox` (https://api.sandbox.pawapay.io) or `production` (https://api.pawapay.io). **Production is refused unless `APP_ENV=production`**; production refuses the sandbox |
| `PAWAPAY_API_TOKEN` | Bearer token from the matching dashboard (sandbox and production tokens differ) |
| `PAWAPAY_SIGNING_PRIVATE_KEY`, `PAWAPAY_SIGNING_KEY_ID` | Request signing; set both or neither. One-line PEM with `\n` is accepted |
| `PAWAPAY_BASE_URL` | Only for a local imitation: `APP_ENV` local or test, a localhost address, never a pawapay.io host, never with production mode |

Secrets live only in the environment of the deployment that uses them: production credentials never in a developer's `.env.local`.

## Dashboard settings (founder / technical administrator)

1. **Sandbox account** (https://dashboard.sandbox.pawapay.io): request it from pawaPay; generate a sandbox API token.
2. **Callback URLs**, per operation type: deposits and refunds both to `https://<origin>/api/v1/callbacks/pawapay`.
3. **Signed callbacks: on.** Without it every callback is unsigned and is refused (payments still complete through status checks, only later).
4. **Signed requests** (recommended): generate an EC P-256 key pair, add the public key under API Security, put the private key and its id in the deployment's secrets, then turn on "Only accept signed requests". For the sandbox on a developer machine, `npx tsx scripts/ops/pawapay-signing-key.ts generate` writes the pair to `.local/pawapay-signing/` (upload `public.pem`), and `... install --key-id <id the dashboard shows>` puts the private key and id into `.env.local` without the key ever being typed or shown, then deletes the private key file (sandbox only; `uninstall` takes them out again). The sandbox probe and `pawapay-sandbox.test.ts` sign whenever a key is installed.
5. The `keyid` of a signed request is the name the key was given when it was added in the dashboard (`PAWAPAY_SIGNING_KEY_ID`), and pawaPay accepts DER-encoded ECDSA signatures (sandbox, 2026-10-25). For callbacks the adapter accepts DER and raw.

## Proving it before launch (gates G1 and G3)

1. **Sandbox (G1):** run the purchase path with pawaPay's Rwanda test numbers (MTN `250783456789` completes, `250783456039` not approved, `250783456129` stays pending; Airtel `250733456789` completes, `250733456049` insufficient balance) and a refund. Done locally on 2026-10-24 without callbacks or request signing, then with request signing and "Only accept signed requests" on (2026-10-25, below). On the staging deployment (2026-10-25, `APP_ENV=staging`, Vercel `dub1`): order BB-J2JS-KAWB (RWF 5,100, MTN `250783456789`) was paid with request signing on; pawaPay's deposit callback reached `https://staging.beautyboxmarket.com/api/v1/callbacks/pawapay`, its signature verified, and the status check confirmed COMPLETED before the order was marked paid. On 2026-11-01 order BB-J2JS-KAWB was refunded in full (RWF 5,100) from the staff order page on 2026-11-01: approved 10:20:33 UTC, sent signed at 10:21:00, pawaPay's refund callback arrived with a verified signature at 10:21:02 and only prompted the status check, which confirmed it; refund SUCCEEDED with no flag, payment REFUNDED, refund case closed.
2. **Live (G3, founder decision):** a controlled live transaction and refund on the production deployment with real handsets (the PIN step is skipped in sandbox), reviewed by finance before public launch.

### Re-running the sandbox checks

With `PAYMENT_PROVIDER=pawapay`, `PAWAPAY_MODE=sandbox` and the sandbox token in `.env.local` (both refuse anything but the sandbox and never print the token):

- `RUN_PAWAPAY_SANDBOX_TESTS=1 npx vitest run --project integration tests/integration/pawapay-sandbox.test.ts`: the app's own checkout, payment check, refund and finance-flag code against the sandbox, on the test database (about 35 s).
- `npx tsx --conditions=react-server --env-file=.env.local scripts/ops/pawapay-sandbox-probe.ts`: the adapter and raw pawaPay answers and timings, saved to `.local/pawapay-sandbox-probe-<time>.json`; `... --deposit <id> --refund <id>` looks earlier ids up.

## Sandbox evidence (2026-10-24)

Account settings at the time: "Sign all callbacks" on; callbacks set to "I do not wish to receive callbacks" (no staging site yet); "Only accept signed requests" off. `GET /v2/active-conf` reported `signedRequestsOnly: false, signedCallbacks: true`. Every call answered in 160–900 ms.

On 2026-10-25 the founder added the request-signing public key (EC P-256, made with `scripts/ops/pawapay-signing-key.ts`) under the id `Beautyrequestsign`; from then on `GET /v2/active-conf` reported `signedRequestsOnly: true`.

| Signing check (2026-10-25) | pawaPay sandbox answer | Meaning |
| --- | --- | --- |
| Deposit signed with our key under `Beautyrequestsign` | `ACCEPTED`, then `COMPLETED`; a signed refund of 400 `ACCEPTED`, then `COMPLETED` | the signature, the key id and DER encoding are accepted |
| Signed with another key under the same id | refused, `HTTP_SIGNATURE_ERROR` | signatures are verified, not just present |
| Signed with our key under an unknown id | `HTTP_SIGNATURE_ERROR` | the id must be the dashboard's name |
| Not signed | 401, `status: REJECTED`, `HTTP_SIGNATURE_ERROR` | unsigned deposits and refunds are refused once signed-only is on (a deposit start fails; a refund waits and retries) |
| Full sandbox probe and `pawapay-sandbox.test.ts`, signed | same answers as the unsigned run of 2026-10-24; tests 4/4 | the app's payment and refund path works with signing on |
| Status checks, active configuration, public keys (unsigned GETs) | 200 | only deposits and refunds need signing |

| Check | pawaPay sandbox answer | App result |
| --- | --- | --- |
| Active configuration, Rwanda | MTN_MOMO_RWA and AIRTEL_RWA for RWF deposits (Airtel 100–1,500,000 RWF); no `status` field on the operation type | both methods offered at checkout |
| Callback signing keys | `GET /v2/public-key/http` lists `HTTP_EC_P256_KEY:1` | key cache works with this id format |
| MTN `250783456789` | `ACCEPTED` (with `nextStep: FINAL_STATUS`), then `COMPLETED`, amount `"1000.00"`, `providerTransactionId` | browser checkout BB-9V7X-8KQJ paid RWF 5,100 only after the status check; receipt evidence `pawapay:deposit:<id>:COMPLETED:<txn>` |
| Same `depositId` again | `DUPLICATE_IGNORED` | treated as accepted, no second deposit |
| Airtel `250733456789` | `PROCESSING`, then `COMPLETED`, `providerTransactionId` like `airtel.money.id.…` | paid (sandbox test) |
| MTN `250783456039` | `FAILED`, `PAYMENT_NOT_APPROVED` | "Payment not completed", try-again offered (browser) |
| Airtel `250733456049` | `FAILED`, `INSUFFICIENT_BALANCE` | same (browser, retry of the same order) |
| MTN `250783456129` | `PROCESSING`, then `IN_RECONCILIATION` (seen after about 1 h 45 min; still not final) | "Approve on your phone… don't pay again", later "Still checking payment… do not pay again"; when the stock hold expired the stock was released but the payment stayed unresolved, flagged `UNKNOWN` for staff, checks continuing (browser, order BB-VJAQ-JTV3) |
| Unknown id | `{"status":"NOT_FOUND"}` | `NOT_FOUND` |
| Decimal amount `"100.5"` | 200 `REJECTED`, `INVALID_AMOUNT` | the adapter never sends one |
| Amount out of range | 200 `REJECTED`, `AMOUNT_OUT_OF_BOUNDS` (MTN: more than 5 and less than 2,000,000) | definite refusal |
| Unknown field | 400 `REJECTED`, `UNSUPPORTED_PARAMETER` | definite refusal |
| Bad token | 401, `failureReason.failureCode: AUTHENTICATION_ERROR`, no `status` | a refusal of the request: a status check stays unknown, a deposit start fails, a refund waits and retries under the same id |
| A rejected id sent again | not stored (`NOT_FOUND`), then `ACCEPTED` under the same id, for deposits and refunds | confirms "look up, then re-send the same id" |
| Refund while another is processing | 200 `REJECTED`, `INVALID_STATE` "A refund is already in progress for this deposit." | retried under the same id, completed, and flagged for finance as a refund the app did not send (sandbox test) |
| Refund above what is left | 200 `REJECTED`, `INVALID_AMOUNT` "…more than the refundable part of the original deposit '600'" | failed and flagged for finance |
| Refund after a full refund | 200 `REJECTED`, `INVALID_STATE` "Requested deposit has been already refunded" | failed and flagged; customer sees "under review" (sandbox test) |
| Refund of a failed deposit | 200 `REJECTED`, `DEPOSIT_NOT_COMPLETED` | failed and flagged |
| Partial refunds 400 + 600 of 1000 | each `ACCEPTED`, then `COMPLETED` with amount `"400.00"` / `"600.00"` | two refunds approved together go one at a time; the rest completes; the order shows `REFUNDED` (sandbox test) |

Rejections in the sandbox use `failureReason.failureCode` and `failureMessage`; the `rejectionReason` shape from the refunds guide was not seen (the adapter still reads it).

A first probe run earlier the same day timed out on three initiations at 15 s, and none of them reached pawaPay. This machine's clock had stopped (it read 10:49:48 UTC for over 20 minutes), and the run was repeated after a restart with every call under a second. The adapter treated each timeout correctly: unknown, looked up, never failed.

## Questions to confirm with pawaPay (or on staging)

- How a callback's `keyid` relates to the ids from `GET /v2/public-key/http` (the sandbox lists `HTTP_EC_P256_KEY:1`), and whether each callback retry is signed again (a retry signed more than 5 minutes earlier is refused; the payment still resolves through status checks).
- Whether production uses `INVALID_STATE` with the "already in progress" wording, as the sandbox does, or the documented `REFUND_IN_PROGRESS` (the adapter handles both; if the wording changes, such a refund is failed and flagged for finance instead of retried, so no money is at risk).
- What `nextStep` values other than `FINAL_STATUS` can appear for Rwanda deposits (the adapter ignores the field; both Rwanda providers use an automatic PIN prompt).

## Known differences in pawaPay's documentation

The research notes (2026-10-24) list documentation inconsistencies the adapter tolerates: 401 vs 403 for authentication failures, with or without `status: REJECTED` (the sandbox sends only `failureReason`; all are refusals of the request: a deposit fails, a refund waits and retries), DER vs raw ECDSA, the `keyid` in the callback example, the active-configuration example's field names (the adapter follows the schema), and unknown future statuses or failure codes (treated as pending or passed through).
