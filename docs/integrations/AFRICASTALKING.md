# Africa's Talking SMS (I11, DR-048)

Built on 2026-11-01 against Africa's Talking's public documentation (developers.africastalking.com: "Bulk (legacy)", "Bulk", "SMS Notifications", "Idempotent Requests", "Request Headers"; read in the browser that day) and their official Node SDK (`AfricasTalkingLtd/africastalking-node.js`, `lib/sms.js`). Tested against simulated answers in the documented shapes. The opt-in test against the real **sandbox** is written and waits for the founder's sandbox API key (see "Sandbox" below). No live account has been used and no SMS has reached a phone.

## What the adapter does (`src/adapters/sms/africastalking.ts`)

| Need | Africa's Talking | Adapter behaviour |
| --- | --- | --- |
| Send one message | `POST /version1/messaging` on `api.sandbox.africastalking.com` (username `sandbox`) or `api.africastalking.com` (any other username); form fields `username`, `to`, `message`, `bulkSMSMode=1`, `from` (sender ID, only when set); headers `apiKey`, `Accept: application/json` | One recipient per request: the order's contact number (never the payer number). The newer JSON endpoint `/version1/messaging/bulk` is not used because its sandbox is "coming soon" (the official SDK makes the same choice). 15 s timeout; answers over 64 KB are treated as unknown |
| Accepted | HTTP 201, `SMSMessageData.Recipients[0].statusCode` 100 Processed, 101 Sent, 102 Queued | `ACCEPTED` with the `messageId` kept on the notification. Acceptance is not handset delivery |
| Not sent | Per-recipient 402 InvalidSenderId, 403 InvalidPhoneNumber, 404 UnsupportedNumberType, 405 InsufficientBalance, 406 UserInBlacklist, 407 CouldNotRoute, 409 DoNotDisturbRejection, 502 RejectedByGateway; the same names in `Message` when no recipient comes back, or "Sent to 0/1"; HTTP 401/403 (bad key or username), 429, or another 4xx with a plain-text explanation | `FAILED` with a code (`INSUFFICIENT_BALANCE`, `AUTHENTICATION`, ...). The handler tries again up to 3 times in total (DR-026), then leaves it `FAILED` for staff (`SMS_FAILED`, ops alert `SMS_NOT_DELIVERED`) |
| May have gone out | Timeout, network error, HTTP 5xx, unreadable 2xx, an answer about another number or several numbers, per-recipient 401 RiskHold (held for review, may be released), 500 InternalServerError, 501 GatewayError, any new code | `UNKNOWN`, never sent again (DR-026). The `messageId` is kept when given, so a later delivery report can still say what happened. Staff see `SMS_OUTCOME_UNKNOWN` |
| Malformed number or empty text | (not sent) | `FAILED` (`INVALID_RECIPIENT`, `EMPTY_MESSAGE`) without calling Africa's Talking |

Africa's Talking supports an `Idempotency-Key` header only for airtime and payment disbursements, not SMS. So nothing on their side stops a resent message from reaching the customer twice; the "never resend an unknown outcome" rule is the only protection.

The API key travels only in the `apiKey` header. Neither the key nor the message text (which carries a private order link) is logged or returned; network errors are reported by error class only.

## Configuration

| Variable | Meaning |
| --- | --- |
| `SMS_PROVIDER=africastalking` | Use Africa's Talking (`fake` stays for local work; `disabled` keeps messages as suppressed) |
| `AFRICASTALKING_USERNAME` | `sandbox` for the sandbox (messages reach only Africa's Talking's simulator). Any other value is a live account that texts real phones, and is **refused unless `APP_ENV=production`**, because every other environment holds synthetic numbers that may belong to real people. Production refuses `sandbox` |
| `AFRICASTALKING_API_KEY` | From the dashboard of the same account (the sandbox has its own key). Server-only, sent to Vercel as a secret |
| `AFRICASTALKING_SENDER_ID` | Approved alphanumeric sender ID (up to 11 characters) or short code. Optional until approved (Africa's Talking then sends from its default); **required in production**. In the sandbox it must be one created in the sandbox dashboard, or left empty |
| `AFRICASTALKING_CALLBACK_TOKEN` | Secret part of the delivery-report address (below). Unset: delivery reports are refused (404) |

All four are server-only; the configuration validator refuses any `NEXT_PUBLIC_` name containing `AFRICASTALKING` or `CALLBACK_TOKEN`.

## Delivery reports

After accepting a message, Africa's Talking posts what the network said about handset delivery to a URL set in its dashboard (SMS → SMS Callback URLs → Delivery Reports), as a form: `id` (the `messageId`), `status` (Sent, Submitted, Buffered, Rejected, Success, Failed, AbsentSubscriber, Expired), `phoneNumber`, `networkCode`, and `failureReason` for Rejected or Failed.

**Africa's Talking does not sign these callbacks**, and offers no way to look a sent message's status up afterwards. So:

- The address carries a random secret: `https://<origin>/api/v1/callbacks/africastalking/delivery-reports/<AFRICASTALKING_CALLBACK_TOKEN>`. Any other address, or reports with no token configured, answer 404. The token is compared in constant time. Make it with `npm run sms:callback-token -- --env-file <file>` (writes the token into the file and copies the full address to the clipboard; `--rotate` replaces it, `--print` shows it).
- A report must name a message id the app stored **and** the number that message went to; anything else is accepted (200, so Africa's Talking does not keep retrying) and ignored.
- A report only updates what staff see about that message (`deliveryStatus`, `deliveryFailureReason`, `deliveryReportedAt` on the notification). It never changes the order, the payment or the message's send state, and never sends anything. So someone who learned the address could at worst mislabel a message's delivery for staff.
- Reports may arrive out of order: a report replaces an earlier one only if it says more (Sent < Submitted < Buffered < AbsentSubscriber < Success, Failed, Rejected, Expired). AbsentSubscriber (phone off or out of coverage) can still be followed by Success.
- Not delivered (Failed, Rejected, Expired, AbsentSubscriber) shows on the order page ("not delivered to the phone (user does not exist)"), as order exception `SMS_NOT_DELIVERED_TO_PHONE`, in the overview count and in the ops summary (`notifications.notDeliveredToPhone`, alert `SMS_NOT_DELIVERED`). Staff check the number with the customer; the app does not resend on its own.
- The secret is in the URL, so it appears in the hosting provider's request logs (Vercel's are access-controlled). The app's own error log replaces it with `:token`. Rotate it if it leaks (`npm run sms:callback-token -- --env-file <file> --rotate`, then update the dashboard, push and redeploy).
- A report is written without moving the message's `updated_at`, so it never restarts the 7-day window in which a failed or unknown send keeps the `SMS_NOT_DELIVERED` alert on. A report never clears an alert or exception either: "delivered to the phone" for a message whose send outcome was unknown is shown next to the unknown flag, not instead of it.

## Message length

Every template is plain GSM-7 (checked by `tests/unit/sms-templates.test.ts`), so a part holds 160 characters, or 153 each when split. The staff-typed support contact is the one value that could bring in other characters; it is cleaned to GSM-7 before sending (curly quotes and dashes become plain ones), so one stray character cannot switch a message to UCS-2 (70 per part) and more than double its cost. Accented letters GSM-7 lacks lose their accent (also when typed as a letter plus a combining mark); anything else becomes "?".

Lengths on `https://beautyboxmarket.com` with a 12-character order reference and "RWF 129,100" (`npm run sms:lengths` prints this, for staging too; staging's address adds 8 characters):

| Template | No help contact | With the support phone | With the proposed short link: none / phone |
| --- | --- | --- | --- |
| ORDER_CONFIRMED | 173 (2 parts) | 194 (2 parts) | 135 (1) / 156 (1) |
| ORDER_DISPATCHED | 175 (2 parts) | 196 (2 parts) | 137 (1) / 158 (1) |
| ORDER_ON_HOLD | 59 (1 part) | 89 (1 part) | no link |
| DELIVERY_PROBLEM | 59 (1 part) | 89 (1 part) | no link |
| REFUND_CONFIRMED | 74 (1 part) | 95 (1 part) | no link |
| ACCESS_LINK | 185 (2 parts) | 206 (2 parts) | 147 (1) / 168 (2) |

The private link is most of the length: `https://beautyboxmarket.com/order-access#token=` plus 43 characters (32 random bytes) is 90 characters.

**Proposal (not built):** `https://beautyboxmarket.com/o#<22 characters>` (52 characters): a one-letter page that does what `/order-access` does, and 16 random bytes (128 bits) instead of 32. The link stays single-use, expires in 7 days, is stored only as a keyed hash, and its exchange is rate-limited per address, so 128 bits is still far beyond guessing. Order confirmations and dispatch notices, sent for every order, would then fit one part even with the support phone, halving their cost. ACCESS_LINK with the phone would still need 8 fewer characters: for example "Works once, for 7 days." instead of "It works once and expires in 7 days." (155, one part), which is a wording change for the B09 review.

Africa's Talking's documentation says opt-out instructions are "automatically appended to the first message you send" to a number from an alphanumeric sender ID (Bulk SMS Opt Out). If that applies to BeautyBOX's sender ID in Rwanda, the first message to each customer is longer than the table shows; confirm with Africa's Talking when the sender ID is approved.

## Sandbox

Africa's Talking's sandbox uses the username `sandbox` and its own API key (in the Africa's Talking account, open the sandbox app, then Settings → API Key). Messages appear only in their simulator (developers.africastalking.com/simulator, opened with the recipient number); nothing reaches a phone and nothing is charged.

The founder adds to `.env.local` (never in chat):

```
SMS_PROVIDER=africastalking
AFRICASTALKING_USERNAME=sandbox
AFRICASTALKING_API_KEY=<sandbox API key>
```

Then:

```bash
RUN_AFRICASTALKING_SANDBOX_TESTS=1 npx vitest run --project integration tests/integration/africastalking-sandbox.test.ts
```

It sends a two-part order message, checks that a wrong key and an invalid number are read as "not sent", and sends the app's own order confirmation through the job handler. Restart `npm run dev` and `npm run worker` after changing `.env.local`. To see local messages in the dev SMS inbox again, set `SMS_PROVIDER=fake`.

Staging can use the sandbox too (`.env.staging.example`), which exercises the whole path on the hosted site including delivery reports from the sandbox.

## Before production

- Live Africa's Talking account, approved sender ID (founder input B07), and a top-up arrangement: an empty balance answers `INSUFFICIENT_BALANCE`, which retries three times and then waits for staff.
- The SMS provider named in the privacy notice before any customer message (G2).
- Delivery-report address set in the **live** account's dashboard with production's own token.
- Approved wording for every template, including ACCESS_LINK (B09), and a decision on the short-link proposal above.
