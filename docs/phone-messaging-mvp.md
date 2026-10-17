# Phone onboarding and messaging MVP

## Architecture

- Firebase Authentication remains the identity provider.
- Public profile data stays in `users`. Phone ownership is stored in the
  server-only `userPrivate` collection so authenticated profile discovery
  cannot expose personal phone numbers.
- SHA-256-keyed `phoneNumberClaims` documents enforce one verified owner per
  E.164 number. `twilioSidClaims` also prevents assigning one Twilio resource
  to multiple accounts.
- `conversations` use the existing deterministic connection pair ID.
  `messages` are top-level Firestore documents. Every API operation checks
  authentication, conversation membership, an accepted connection, and blocks.
- Clients poll conversation lists every 5 seconds and open chats every 3
  seconds. No additional realtime service is required.
- External SMS is not implemented or enabled. Nearby-to-Nearby messages never
  use Twilio.

Firestore has no migration runner in this repository. Deploy the additive
rules and indexes:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Existing user documents need no backfill. New accounts receive
`phoneOnboardingRequired: true`; the API clears it after verification or
assignment.

## Local setup and testing

Copy `apps/api/.env.example` to `apps/api/.env` and leave:

```dotenv
TWILIO_MOCK=true
TWILIO_ENABLE_PHONE_PURCHASES=false
```

Mock Verify accepts `000000`. Mock assignment creates a deterministic fake
number and SID. It cannot contact Twilio or incur charges.

```bash
pnpm install --frozen-lockfile
pnpm --filter @nearby/api test
pnpm typecheck
pnpm build
pnpm dev
```

For a controlled Verify test, set the Twilio account, auth token, and Verify
Service SID, then set `TWILIO_MOCK=false`. Verify sends are billable. Number
purchases remain blocked unless an operator separately sets
`TWILIO_ENABLE_PHONE_PURCHASES=true`; the UI still requires the user to confirm
the displayed monthly estimate.

## Cost estimate

Prices vary by destination, number type, carrier, and tax. Confirm them in the
Twilio console immediately before enabling production:

- Twilio Verify in the US: **$0.05 per successful verification plus $0.0083
  per SMS attempt**, according to Twilio pricing current August 2026.
- A US local 10DLC number is commonly around **$1.40/month per assigned user**;
  available-number results and the Twilio console are authoritative.
- In-app messages use Firestore and incur no Twilio SMS fee.
- External SMS, if later approved, adds per-segment Twilio and carrier fees.
  US application-to-person traffic also requires A2P 10DLC registration.
  Twilio documents a **$15 campaign vetting fee**, plus brand/campaign and
  possible recurring fees that depend on registration type.

References:

- https://www.twilio.com/en-us/verify/pricing
- https://www.twilio.com/en-us/phone-numbers/pricing
- https://www.twilio.com/docs/messaging/compliance/a2p-10dlc

## Production readiness

Before launch:

1. Use Twilio production credentials only in the API secret store and rotate
   them periodically.
2. Set the monthly estimate from the actual selected number inventory; taxes
   and fees must be included in customer-facing billing terms.
3. Configure Firebase TTL cleanup for expired `rateLimits` documents.
4. Add operational alerts for Verify errors and provisioning rows left in
   `PROCESSING`. Provisioning reconciles by the per-user Twilio friendly name
   before buying, which protects retries after an interrupted response.
5. Define account-recovery identity checks. Personal-number changes verify the
   replacement before releasing the old claim. Assigned numbers are never
   automatically released; support must confirm cancellation and hold the
   number through a documented reassignment quarantine.
6. Publish privacy, retention, acceptable-use, reporting, and law-enforcement
   policies. Establish moderation handling for reports and abuse.
7. If external SMS is later built, require explicit feature approval, Twilio
   webhook signature validation, webhook-event idempotency, per-user quotas,
   consent evidence, STOP/HELP handling, A2P registration, and country-specific
   telecom review. Personal-number users must never be allowed to spoof their
   number through Twilio.

The current API does not log OTP values or message bodies. Standard request
logging records paths and status only.
