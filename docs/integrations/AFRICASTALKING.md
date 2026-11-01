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

## Message length: one part each in production (DR-049)

At the founder's request (2026-11-01) every message costs **one SMS part** (160 GSM-7 characters) in production, half what confirmations, dispatch notices and new-link messages cost before (2 parts each). How:

- **Short private-link page for SMS:** `https://beautyboxmarket.com/o#<token>` (73 characters instead of 90). The token keeps the handoff's minimum of 32 random bytes (43 characters; Security-and-Operations "Private order access"). The page `/o` does exactly what `/order-access` does (the token is read from the fragment, removed from the address bar and exchanged once) and has the same headers; links shown in the browser (CC-08) keep the `/order-access#token=` form. No contract change. (A 16-byte token was tried first and withdrawn: it broke the handoff's rule, and production fits one part without it.)
- **The link always comes last,** with nothing after it. Some phones glue a trailing full stop onto a link; the page also ignores anything after the token, which protects links already sent in the old form.
- **"BeautyBOX: " opens every message** (who is writing, even when the message is forwarded). It is left out only when the sender already shows BeautyBOX (the approved `AFRICASTALKING_SENDER_ID`, matched case-insensitively on "beautybox") **and** keeping it would cost a part. Messages without a link keep the brand ahead of the optional extra, because nothing else in them says who is writing; messages with a link (whose address names BeautyBOX) keep the help contact ahead of the brand.
- **Optional extras only where they are free:** the help contact (link messages and refunds) and the line "We never ask for your PIN." (holds and delivery problems) are added only when they do not add a part. Until the sender ID is approved, link messages have no room for the help contact; the order page shows it.
- **Plain GSM-7 only** (tested), and the sent text is cleaned to GSM-7, so a staff-typed support contact cannot switch a message to UCS-2 (70 per part). Accented letters GSM-7 lacks lose their accent (also when typed as a letter plus a combining mark); anything else becomes "?".

Wording (drafts until the B09 sign-off). It was chosen by a panel of three drafts (lowest cost, clarity for second-language readers, trust) and a judge who re-counted every length, then corrected after review:

| Message | Text (`{brand}` = "BeautyBOX: ", left out only as described above; `[...]` = added only when free) |
| --- | --- |
| Order confirmed | `{brand}Order BB-J2JS-KAWB is paid: RWF 29,100.[ Help: +250788123456.] See your order: <link>` |
| Order dispatched | `{brand}Order BB-J2JS-KAWB has been handed to our rider.[ Help: ...] See your order: <link>`. Past tense, so it stays true if staff record the handover late |
| Order on hold | `{brand}We need to talk with you about order BB-J2JS-KAWB. Please contact us at +250788123456.[ We never ask for your PIN.]` (no contact set: "We will contact you.") |
| Delivery problem | `{brand}We need to talk with you about the delivery of order BB-J2JS-KAWB. Please contact us at ...[ We never ask for your PIN.]`. Not "we could not deliver", the wording of a common fake-parcel scam |
| Refund confirmed | `{brand}Your refund of RWF 5,100 for order BB-J2JS-KAWB is confirmed. It goes back to the number used for payment.[ Help: ...]`. The SMS goes to the order's contact, who may not be the payer |
| New private link | `{brand}New link for order BB-J2JS-KAWB. Do not share it.[ Help: ...] Use once, within 7 days: <link>`. Forwarding the link before opening it would lock the customer out |

Worst case in production (`npm run sms:lengths`; "RWF 1,250,000", generic sender, support phone): confirmation 143, dispatch 149, on hold 124, delivery problem 140, refund 142, new link 159. Every production combination of message, sender (generic or BeautyBOX) and contact (none, phone, e-mail) is one part. The table's "Brand" column shows the few cases where the prefix gives way (the sender shows BeautyBOX, to fit the help contact or one part) and its "Extra" column whether the help or PIN line fitted. On staging, whose address is 8 characters longer (sandbox messages are free), the new-link message from a generic sender is two parts. `tests/unit/sms-templates.test.ts` fails if any production combination needs a second part. **Keep the support e-mail to 60 characters or fewer:** the hold and delivery-problem messages must include the contact, and with a longer address (and no support phone) they take two parts. The staff settings page says so next to the field.

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

It sends an order confirmation as the app renders it (one part), checks that a wrong key and an invalid number are read as "not sent", and sends the app's own order confirmation through the job handler. Restart `npm run dev` and `npm run worker` after changing `.env.local`. To see local messages in the dev SMS inbox again, set `SMS_PROVIDER=fake`.

Staging can use the sandbox too (`.env.staging.example`), which exercises the whole path on the hosted site including delivery reports from the sandbox.

## Before production

- Live Africa's Talking account, approved sender ID (founder input B07), and a top-up arrangement: an empty balance answers `INSUFFICIENT_BALANCE`, which retries three times and then waits for staff.
- The SMS provider named in the privacy notice before any customer message (G2).
- Delivery-report address set in the **live** account's dashboard with production's own token.
- Sign-off of the wording above (B09), including the new-link message.
