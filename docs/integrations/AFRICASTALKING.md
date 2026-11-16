# Africa's Talking SMS — sending disabled

The adapter is implemented and tested with mocked HTTP responses. **No real SMS has been sent or verified by this work.** Provider acceptance (`Processed`, `Sent`, `Queued`, codes 100–102) is recorded as ACCEPTED, never as proof of delivery to a handset.

`SMS_PROVIDER=fake` preserves the local inbox. `SMS_PROVIDER=disabled` suppresses notifications. Selecting `africastalking` with the default `AFRICASTALKING_SEND_ENABLED=false` also uses the disabled adapter; credentials are unnecessary while off. Staff's existing notifications switch remains an additional gate.

Private configuration (never `NEXT_PUBLIC_`, source, chat or logs):

| Variable | Rule |
| --- | --- |
| `AFRICASTALKING_SEND_ENABLED` | `false` by default; keep it false for this PR |
| `AFRICASTALKING_MODE` | `sandbox` by default; `live` is refused outside production |
| `AFRICASTALKING_USERNAME` | `sandbox` for sandbox, approved account username for live |
| `AFRICASTALKING_API_KEY` | Private provider key |
| `AFRICASTALKING_SENDER_ID` | Approved alphanumeric sender or short code, 1–11 characters |

The classic [official SMS API](https://developers.africastalking.com/docs/sms/sending/bulk) uses form encoding and the private `apiKey` header. Hosts are fixed to `https://api.sandbox.africastalking.com/version1/messaging` and `https://api.africastalking.com/version1/messaging`. No custom URL or redirect can receive the key. Responses are streamed up to 64 KiB; timeout covers request and response reading (10 seconds). The adapter makes one request and never retries automatically.

Only a single exact recipient with a recognized acceptance status is ACCEPTED. Known explicit rejections and definite HTTP refusals use the existing outbox policy (three attempts with backoff, then staff review). Mismatched/missing recipients, RiskHold, unrecognized statuses, 5xx/408, malformed or oversized bodies and lost/timeout responses are UNKNOWN. Error results contain fixed codes, never provider body text, private links, numbers or credentials.

The durable outbox records SEND_IN_PROGRESS **before** contacting the provider. A recovered worker encountering that marker, or a recorded UNKNOWN result, must never blindly resend. Investigate in the provider dashboard and with the customer before any separately authorized new message. SMS results cannot alter payment, refund, stock or fulfillment truth. ACCEPTED has no delivery-report integration in this scope; staff must not describe it as delivered.

Before a future live enablement, the owner must supply the approved Rwanda account and sender, credit, reviewed message copy (including private-link and multipart behavior), contact/privacy approvals and a controlled real delivery check. Confirm sender/account coverage with Africa's Talking. Enabling live SMS is a separate owner action; do not change hosted settings under this PR. `npm run audit:optional` reports readiness without provider requests. Tests in `africastalking-adapter.test.ts`, `env-sms.test.ts` and the database outbox regressions are offline evidence only.
