# Nearby Hello spatial-platform refactor plan

Updated: October 21, 2026

## Decision status

Option A was approved on October 21, 2026. Nearby Hello is officially
pivoting from a voice-first assistant to a privacy-first hyperlocal spatial
intelligence platform. Existing voice, messaging, authentication, agent, and
wearable infrastructure will be preserved for future integration but removed
from the primary experience.

The consumer-facing name is always **Nearby Hello**. "Nearby Pulse" and
"Pulse" are prohibited in UI, navigation, onboarding, and marketing.

## Current architecture

- **Monorepo:** pnpm workspace containing `apps/web`, `apps/mobile`,
  `apps/api`, and `packages/shared`.
- **Web:** Next.js 15 App Router, React 19, Tailwind CSS 4, React Query,
  Zustand, and Firebase client SDK. `/nearby`, `/explore`, and `/patterns`
  are the primary spatial surfaces; preserved Talk remains at `/activity`.
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
- **Location:** one-shot foreground location is used for spot readings. The
  location intelligence service can refresh and watch significant changes
  while a spatial screen is active, but only after foreground permission has
  already been granted. It stores no user location history.
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

## Components to modify

- Replace the Talk-first information architecture with Nearby, Explore,
  Patterns, and Profile on both web and mobile.
- Add explicit, per-sensor consent and session controls; existing auth consent
  is not permission to collect environmental data.
- Split public profile data from private account data before adding any
  location-derived feature. Current authenticated reads of `users` documents
  are too broad for a spatial product.
- Introduce typed provider interfaces for location, dBFS loudness,
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

## Spatial intelligence components

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
   - dBFS loudness computed locally with explicit microphone
     permission; never raw audio or transcription.
   - Broad device movement state where platform APIs support it.
   - Unsupported web capabilities represented explicitly.
4. **Nearby Hello clients**
   - A map abstraction shared at the domain level, with platform-specific
     renderers.
   - Example, personal, and thresholded community modes with visible provenance,
     freshness, confidence, and missing-data states.
5. **Operations**
   - Retention jobs, rate limits, audit-safe deletion, metrics, API
     documentation, privacy documentation, and CI.
6. **Place intelligence**
   - Provider-independent `SpatialPlace`, source, external-ID, attribution,
     and future `SpatialObservation` contracts.
   - Server-side OpenStreetMap/Overpass ingestion with normalization,
     duplicate detection, idempotent Firestore upserts, distance filtering,
     category filters, pagination, retries, quotas, and TTL lookup caches.
   - Nominatim manual location search as the permission-denied fallback.
   - Nearby and Explore place cards on web and Expo. Static place metadata is
     kept separate from unpopulated future dynamic observations.

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
- `spatialPlaces/{placeId}`
- `spatialPlaceLookups/{lookupId}`
- `spatialObservations/{observationId}` (reserved and unpopulated)

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

## Implementation phases

1. **Product and privacy gate:** update the product source of truth; define
   pilot geography configuration, retention periods, zone resolution,
   contributor thresholds, and deletion policy.
2. **Contracts and pure intelligence functions:** add shared models plus tests
   for zone assignment, validation, windows, baselines, classifications, and
   confidence. No collection enabled.
3. **Additive backend:** add server-only Firestore collections, indexes,
   authenticated APIs, rate limits, ownership checks, and example fixtures that
   are visibly synthetic.
4. **Nearby Hello UI:** ship map-first web and mobile surfaces with example and
   unavailable states before real sensing.
5. **Personal foreground collection:** add granular consent and start/stop
   sessions. Keep sound processing local and upload only dBFS loudness
   measurements and quality metadata.
6. **Community aggregation:** enable only after deletion, retention, abuse,
   and minimum-contributor controls pass automated privacy tests.
7. **Validation and rollout:** run builds, API and client tests, security and
   privacy review, and a configurable Washington, DC pilot without embedding
   DC assumptions in domain logic.

Each phase must remain deployable with the spatial feature flag off.

## Phase 1 place/location implementation

1. Reuse Firebase, Hono, shared contracts, and existing authenticated clients;
   do not introduce PostGIS for this fixed-radius pilot workload.
2. Refresh location on app open only when permission is already granted.
   Watch configurable significant changes while active, and remove every
   subscription on unmount. Never enable background tracking.
3. Use lazy OpenStreetMap ingestion for the requested pilot area and an
   authenticated optional sync hook for scheduled warming.
4. Normalize and cache only license-compatible static provider fields.
   Calculate Haversine distance in shared code and filter/sort server-side.
5. Show real place metadata with OSM attribution and freshness. Never populate
   outlet, seating, crowd, queue, or noise observations without a legitimate
   source.

## Principal risks

- **Product transition:** hidden legacy routes and current user data must
  remain functional while the primary experience changes.
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

## Implementation boundary

The approved MVP includes additive spatial contracts, protected APIs,
location-first web and Expo experiences, foreground permission-based sensor
collection, deterministic aggregation, privacy thresholds, deletion controls,
tests, and documentation. It excludes destructive legacy cleanup, background
tracking, individual proximity matching, wearable collection, and public
social discovery.
