# Nearby architecture audit and spatial-platform decision gate

Updated: October 21, 2026

## Decision status

The requested hyperlocal spatial-intelligence product is **not approved for
implementation in the current repository state**. The binding product source
of truth, [`nearby-product-and-icp.md`](nearby-product-and-icp.md), defines
Nearby as a voice-first wearable assistant and makes the social/spatial layer a
later phase. It also requires the color-clip scanning UI to remain disabled.

Nearby Pulse would replace the approved product's primary experience, sensing
model, data model, and positioning. This document therefore records the audit
and a reversible proposal, but no spatial collection, map UI, or production
schema is enabled. Implementation requires an explicit update to
`nearby-product-and-icp.md` and `.cursor/rules/nearby-product.mdc`.

## Current architecture

- **Monorepo:** pnpm workspace containing `apps/web`, `apps/mobile`,
  `apps/api`, and `packages/shared`.
- **Web:** Next.js 15 App Router, React 19, Tailwind CSS 4, React Query,
  Zustand, and Firebase client SDK. `/activity` is the Talk surface;
  messaging, connectors, profile, settings, onboarding, and auth routes are
  active. `/nearby` and `/connections` redirect to `/activity`.
- **Mobile:** Expo Router / React Native with foreground location, audio,
  speech, and BLE libraries. Talk, messaging, connectors, profile, settings,
  auth, and pendant-session flows are active.
- **API:** Hono on Node, deployed by Render. It provides Firebase-authenticated
  agent, messaging, memory, voice memo, connector, billing, phone, invite,
  legacy match, and BLE-sighting endpoints.
- **Persistence:** Firebase Auth, Firestore, and Firebase Storage. Firestore
  rules and indexes are deployed through the Firebase CLI. There is no SQL
  database, migration runner, PostGIS instance, map SDK, spatial index, or
  durable environmental-observation model.
- **AI and integrations:** OpenAI powers agent turns, transcription, and
  memory embeddings. Tavily supports web search. Google Calendar, Tasks, and
  Gmail are available through the connector layer; Stripe and Twilio support
  billing and phone features.
- **Location:** one-shot foreground coordinates are sent only when an agent
  turn needs location. They are not persisted. Current proximity code models
  legacy device sightings and compatibility, not place intelligence.
- **Delivery:** Vercel web configuration, Render API blueprint, Expo mobile
  configuration, and Firebase rules/index deployments. No checked-in CI
  workflow exists.
- **Tests:** API tests cover 38 cases across billing, demo access, location
  requirements, email verification, invites, memories, messaging, phone,
  rescheduling, voice memos, and web search. Web, mobile, shared, and firmware
  have no automated test suites.

## Components to retain

- Firebase authentication, email verification, and existing user records.
- Existing Firestore messaging, invites, connectors, and user-owned memory.
- Hono API conventions, Firebase Admin authorization, and mock-mode test
  infrastructure.
- `packages/shared` as the home for versioned client/device/API contracts.
- Foreground-only location helpers as a starting point for a future
  `LocationProvider`.
- Expo audio and motion-capable native boundary, while preserving the rule
  that raw room audio is not recorded or uploaded.
- Web/mobile parity conventions and existing deployment paths.
- Legacy `/v1/matches` and `/v1/ble/sightings` compatibility endpoints,
  disabled from navigation as required by the current product decision.

## Components to modify if the pivot is approved

- Replace the Talk-first information architecture with Pulse, Explore,
  Patterns, and Profile on both web and mobile.
- Add explicit, per-sensor consent and session controls; existing auth consent
  is not permission to collect environmental data.
- Split public profile data from private account data before adding any
  location-derived feature. Current authenticated reads of `users` documents
  are too broad for a spatial product.
- Introduce typed provider interfaces for location, relative sound intensity,
  motion state, and future Bluetooth proximity. Browser implementations must
  report unsupported capabilities rather than simulate native sensing.
- Add retention enforcement, contributor deletion, abuse controls, and
  privacy-thresholded aggregate reads.
- Add web/mobile/shared tests and CI gates in addition to API tests.

## Components to deprecate from primary navigation if approved

These must be feature-flagged or redirected, not deleted:

- Talk as the default route and chatbot-like turn history.
- Connector-first onboarding and voice-agent marketing.
- Business/place answers generated through general web search.
- Social compatibility, facilitate, and individual nearby-profile surfaces.
- Legacy BLE/color-ring experiments as product features. Firmware reference
  trees remain intact.

Messaging, authentication, and existing user data remain available during any
migration.

## Proposed new components

This is a design proposal, not an enabled implementation.

1. **Shared contracts**
   - `SpatialZone`, `EnvironmentalObservation`, `EnvironmentalAggregate`,
     `HistoricalPattern`, `SensorSession`, consent records, source/quality
     metadata, and measured/estimated/historical provenance.
   - Extensible observation-type registry instead of one collection per
     sensor.
2. **API modules**
   - Zone lookup, session lifecycle, observation ingestion, aggregate reads,
     historical-pattern reads, consent management, and contribution deletion.
   - Validation, plausibility bounds, zone assignment, time-window
     aggregation, baseline generation, confidence scoring, and minimum
     contributor thresholds.
3. **Client sensor adapters**
   - Foreground location on web and Expo.
   - Relative sound intensity computed locally with explicit microphone
     permission; never raw audio or transcription.
   - Broad device movement state where platform APIs support it.
   - Unsupported web capabilities represented explicitly.
4. **Pulse clients**
   - A map abstraction shared at the domain level, with platform-specific
     renderers.
   - Demo, personal, and thresholded community modes with visible provenance,
     freshness, confidence, and missing-data states.
5. **Operations**
   - Retention jobs, rate limits, audit-safe deletion, metrics, API
     documentation, privacy documentation, and CI.

## Persistence and migration strategy

PostGIS is not justified as the first step solely because the existing
database is Firestore. Start with additive, server-only Firestore collections
and coarse, deterministic zone IDs (for example, a reviewed geohash or
equal-area grid resolution), indexed by zone, observation type, and time.
Never store a public user-to-location history.

Proposed collections:

- `spatialZones/{zoneId}`
- `sensorSessions/{sessionId}`
- `environmentalObservations/{observationId}`
- `environmentalAggregates/{aggregateId}`
- `historicalPatterns/{patternId}`
- `sensorConsents/{userId}`

All writes should be API-only. Aggregate documents must exclude user IDs and
remain unavailable until privacy thresholds are met. Raw observations need an
expiry timestamp and deletion ownership metadata. Deploy additive rules and
indexes through the existing Firebase CLI workflow; do not rewrite existing
collections or backfill users.

Evaluate PostGIS only after measured requirements exceed Firestore's model,
such as arbitrary polygon containment, multi-resolution spatial joins, or
high-volume ad hoc space-time analysis. If that threshold is reached, use a
dual-write migration with reconciliation before changing reads; do not perform
an irreversible cutover.

## Implementation phases after approval

1. **Product and privacy gate:** update the product source of truth; define
   pilot geography configuration, retention periods, zone resolution,
   contributor thresholds, and deletion policy.
2. **Contracts and pure intelligence functions:** add shared models plus tests
   for zone assignment, validation, windows, baselines, classifications, and
   confidence. No collection enabled.
3. **Additive backend:** add server-only Firestore collections, indexes,
   authenticated APIs, rate limits, ownership checks, and demo fixtures that
   are visibly synthetic.
4. **Pulse UI:** ship map-first web and mobile surfaces behind one feature
   flag, with demo and unavailable states before real sensing.
5. **Personal foreground collection:** add granular consent and start/stop
   sessions. Keep sound processing local and upload only relative intensity
   measurements and quality metadata.
6. **Community aggregation:** enable only after deletion, retention, abuse,
   and minimum-contributor controls pass automated privacy tests.
7. **Validation and rollout:** run builds, API and client tests, security and
   privacy review, and a configurable Washington, DC pilot without embedding
   DC assumptions in domain logic.

Each phase must remain deployable with the spatial feature flag off.

## Principal risks

- **Product contradiction:** implementing Pulse now would directly conflict
  with the approved M1 voice-agent milestone.
- **Reidentification:** sparse observations can expose routines even when
  names are removed; coarse zones and thresholds are necessary but not always
  sufficient.
- **Misleading claims:** participating-device activity is not occupancy or
  pedestrian count, and uncalibrated microphones provide relative—not
  calibrated decibel—measurements.
- **Browser limits:** web motion and ambient-audio behavior varies by browser
  and cannot stand in for native background sensing.
- **Firestore limits:** spatial containment and analytical scans are awkward;
  premature PostGIS would add a second operational data plane.
- **Current privacy model:** broad authenticated profile reads must be fixed
  before any spatial community feature.
- **Cold start:** personal and demo modes must provide value while community
  aggregates remain unavailable.
- **Operational gaps:** no CI, incomplete retention enforcement, and no
  account-wide deletion/export endpoint.

## Current implementation boundary

No application code, schema, sensor permissions, map dependency, or
environmental data collection should be added until the product decision gate
at the top of this document is resolved. The safe next change is to update the
two product source-of-truth files, including whether the voice assistant is
replaced or whether Pulse is a separately flagged experiment.
