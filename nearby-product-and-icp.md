# Nearby Hello (nearbyhello.com): current product

Last updated October 21, 2026. This replaces the October 16 voice-first
assistant direction and the earlier color-clip brief.

## What Nearby Hello is now

Nearby Hello is a privacy-first hyperlocal spatial intelligence platform. It
helps people understand the physical environment immediately around them
through geospatial context, permission-based smartphone sensors,
environmental measurements, recent changes, and historical spatial patterns.

Mission: **Make the physical world understandable, one location at a time.**

The central question is: **What can I understand about the physical space
around me that I would not otherwise know?**

The consumer-facing name is always **Nearby Hello**. Do not use "Nearby
Pulse" or "Pulse" in navigation, onboarding, UI, or marketing.

Nearby Hello is not a chatbot, business recommendation engine, review
platform, traditional social network, surveillance product, or individual
tracking system. Existing voice, messaging, agent, and wearable
infrastructure remains available for future integration but is not the
primary experience.

## Hardware

Smartphones are the initial sensing platform. Future Nearby Hello wearables
may contribute through the same contracts after a separate product and
privacy review. Existing firmware remains in the repository and must not be
destructively removed or represented as part of the spatial MVP.

## Architecture (modular, loosely coupled)

| Layer | Responsibility | MVP |
|---|---|---|
| Experience | Nearby, Explore, Patterns, Profile | web and Expo |
| Sensor providers | location, dBFS loudness, motion, future Bluetooth | foreground, explicit consent |
| Spatial API | zones, sessions, observations, aggregates, patterns, deletion | Hono in `apps/api` |
| Place providers | normalized place identity, category, distance, attribution | OpenStreetMap pilot |
| Intelligence | validation, normalization, aggregation, baselines, classifications, confidence | deterministic rules |
| Persistence | additive spatial collections and indexes | Firestore |
| Shared contract | sensor, spatial, privacy, and API types | `packages/shared` |

Measured facts, statistical estimates, historical patterns, example
data, and unavailable states must always be visually and structurally
distinct.

## Existing repository

Reuse the Hono API, Firebase authentication and storage, Next.js web app,
Expo mobile app, shared package, deployment configuration, messaging, voice,
agent, and wearable code. Do not rebuild or destructively remove working
infrastructure.

- `apps/api`: authenticated spatial APIs and deterministic intelligence engine.
- `packages/shared`: spatial, sensor, privacy, and existing compatibility contracts.
- `apps/mobile`: foreground native sensing and the full Nearby Hello experience.
- `apps/web`: foreground browser capabilities and the full Nearby Hello experience.
- Existing voice, agent, messaging, social, and firmware code remains
  available through hidden routes or future modules.

## Rules

- Sensor consent is granular by category and independent of account consent.
- Collection is foreground only by default, visibly active, and easy to stop.
- A user may explore without contributing sensor data.
- Process ambient sound locally. Upload only uncalibrated dBFS and quality
  metadata; never upload raw audio or transcribe conversations.
- Activity means participating-device motion only, never occupancy or total
  pedestrian counts.
- Do not expose individual movement histories or precise contributed
  locations through public APIs.
- Aggregate space and time, require minimum contributor thresholds, minimize
  retention, and support deletion of eligible user contributions.
- Clearly label live, recent, historical, personal, community, example,
  and unavailable information. Never fabricate live measurements.
- Keep Washington, DC pilot configuration out of domain logic.
- Use deterministic rules, not an LLM, for environmental intelligence.
- Static place identity and category may come from licensed geographic
  providers. Keep them separate from dynamic observations; never infer or
  claim seating, outlets, crowds, queues, or activity without a legitimate
  source.
- Keep sensor providers modular across browser, Expo, native mobile, and
  future wearables.
- Preserve existing user data and hidden legacy functionality.
- Do not put API secrets in clients or firmware.
- Keep legacy color-ring firmware and `/v1/matches` and
  `/v1/ble/sightings` compatibility APIs, but do not restore individual
  proximity matching.
- Future social presence requires a separate explicit opt-in.

## Priorities

1. Privacy and truthful representation
2. Useful experience with zero other users
3. Reliable foreground location, sourced nearby places, and supported sensor measurements
4. Clear freshness, provenance, uncertainty, and missing-data states
5. Modular spatial and sensor architecture
6. Efficient aggregation and historical patterns
7. Future wearable and opt-in social extensibility

## Milestones

- **M1, location-first shell:** Nearby, Explore, Patterns, and Profile on web
  and Expo, with real foreground location, sourced nearby places, manual
  location fallback, and honest unavailable states.
- **M2, personal collection:** explicit location, relative-sound, and motion
  consent with start/stop controls and user-owned observation history.
- **M3, spatial intelligence:** validated zone assignment, time-window
  aggregates, historical baselines, confidence, and classifications.
- **M4, privacy-safe community mode:** minimum contributor thresholds,
  retention, deletion, abuse controls, and no individual histories.
- **M5, configurable DC pilot:** evaluate usefulness across locations and
  times without hardcoding one geography.
- **Later:** wearable contribution and separately opted-in social discovery.

## Build order

1. Maintain the repository audit and architecture plan.
2. Add shared spatial contracts and tested deterministic intelligence rules.
3. Add authenticated, additive Firestore APIs and privacy controls.
4. Build the location-first web experience.
5. Mirror the complete experience in Expo.
6. Add foreground sensor providers and explicit consent.
7. Connect clients to personal and thresholded community data.
8. Validate tests, builds, privacy controls, and documented limitations.

## Daily-use scenarios

- **Before leaving:** understand how the nearby soundscape and participating
  device activity compare with typical conditions.
- **On arrival:** inspect recent measurements, freshness, confidence, and
  whether enough evidence exists for a useful classification.
- **During a visit:** take one short foreground spot reading and see digital
  loudness and device movement without recording audio.
- **Later:** compare personal observations by hour and weekday as historical
  support becomes sufficient.

## Public positioning

Nearby Hello explains environmental conditions without recommending
businesses, rating places, or claiming to observe people who did not
participate. Posted links preserve channel attribution:
`?utm_source=instagram`, `?utm_source=tiktok`, or `?utm_source=linkedin`.

## Still to decide

Do not invent the target customer, pricing, subscription packaging,
production map-provider commitment, long-term spatial resolution, or social
presence behavior. Validate these with the MVP and pilot. Social discovery
always requires separate explicit opt-in.
