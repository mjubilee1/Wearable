# Nearby Hello

A privacy-first hyperlocal spatial intelligence platform. Nearby Hello uses
permission-based foreground sensors, approximate spatial zones, environmental
measurements, and historical patterns to help people understand the physical
space around them.

Product: [`nearby-product-and-icp.md`](nearby-product-and-icp.md). Architecture
and migration plan: [`NEARBY_REFACTOR_PLAN.md`](NEARBY_REFACTOR_PLAN.md).

## Spatial MVP

1. **Nearby** — current approximate zone, environmental measurements,
   freshness, confidence, and one-button spot readings.
2. **Explore** — interactive privacy-preserving spatial grid and nearby zones.
3. **Patterns** — personal or privacy-thresholded historical time buckets.
4. **Profile** — account, contribution management, and preserved legacy
   messaging/voice tools.

Data modes:

- **Example:** visibly synthetic observations for an immediate
  zero-user experience.
- **Personal:** only the signed-in user's foreground measurements.
- **Community:** aggregate insights available only at three or more distinct
  contributors.

“Read this spot” asks for foreground location, microphone, and motion
permissions only after the user taps it. It samples for about 10 seconds,
stores numeric location/time, dBFS loudness, and motion intensity, then stops.
Raw audio is never uploaded; temporary mobile recordings are deleted locally.
Activity is participating-device motion only, never occupancy or pedestrian
counts. After at least three readings in a matching weekday/hour bucket,
Nearby Hello can compare the current reading with the user's usual conditions.

Existing voice, messaging, connectors, authentication, and firmware remain in
the repository for future integration but are not primary navigation.

### Nearby place discovery

Nearby and Explore include a real nearby-place list sourced from OpenStreetMap.
The API queries Overpass, normalizes provider records, deduplicates and upserts
place metadata, calculates distances, and caches repeated lookups. Nominatim
powers the manual city/address/place fallback. Place cards show only sourced
static metadata; they do not claim that seating, outlets, crowds, or other
conditions are currently available.

### Scan surroundings (AI observations)

Users can tap **Scan surroundings**, choose the place shown in the photo, and
submit one authorized image. The API validates the payload, matches the place
only with enough confidence or an explicit selection, runs a vision provider,
and stores structured observations—not the image.

- With `OPENAI_API_KEY`, vision uses `OPENAI_VISION_MODEL` (default
  `gpt-4o-mini`) at low detail for cost control.
- Without a key, or with `VISION_FIXTURE_MODE=true`, the free local fixture
  provider is used so development and tests do not require paid inference.
- Dynamic attributes such as apparently empty seats expire quickly.
- Natural-language nearby questions use deterministic intent parsing and
  geospatial filtering before any grounded answer is returned.
- Unsupported claims (Wi‑Fi quality, total occupancy, working outlets) are
  never invented.

If foreground location was already granted, the app refreshes it on open and
watches only significant changes while active. A first-time prompt still
requires the user to tap **Read this spot**. Tracking stops when the discovery
component unmounts, does not run in the background, and does not store a user
location history.

## Voice firmware

XIAO nRF52840 Sense (the board on the desk):

```bash
cd firmware/wakeword
pio run -e xiaoblesense -t upload
pio device monitor -e xiaoblesense -b 115200
```

## Apps

| Package | Path | Role |
|---------|------|------|
| `@nearby/web` | `apps/web` | Next.js location-first experience |
| `@nearby/mobile` | `apps/mobile` | Expo foreground sensor experience |
| `@nearby/api` | `apps/api` | Hono spatial and preserved legacy API |
| `@nearby/shared` | `packages/shared` | Spatial, sensor, privacy, and legacy contracts |

## Setup

```bash
pnpm install
pnpm dev          # web :3000 + api :4000
pnpm dev:mobile   # Expo
```

Copy env files from each app’s `.env.example`. Optional pilot coordinates:

```bash
NEXT_PUBLIC_PILOT_LATITUDE=38.9072
NEXT_PUBLIC_PILOT_LONGITUDE=-77.0369
EXPO_PUBLIC_PILOT_LATITUDE=38.9072
EXPO_PUBLIC_PILOT_LONGITUDE=-77.0369
NEXT_PUBLIC_LOCATION_DISTANCE_THRESHOLD_METERS=100
EXPO_PUBLIC_LOCATION_DISTANCE_THRESHOLD_METERS=100
NEXT_PUBLIC_LOCATION_MAX_ACCURACY_METERS=500
EXPO_PUBLIC_LOCATION_MAX_ACCURACY_METERS=500
```

These defaults configure the labeled example viewport only; spatial
domain logic is not DC-specific.

Billing UI and checkout/referral endpoints are dormant by default. Existing
Stripe integration remains available for future use:

```bash
BILLING_ENABLED=false
NEXT_PUBLIC_BILLING_ENABLED=false
EXPO_PUBLIC_BILLING_ENABLED=false
```

OpenStreetMap provider settings:

```bash
OVERPASS_API_URL=https://overpass-api.de/api/interpreter
# Optional comma-separated failover endpoints:
OVERPASS_API_URLS=
NOMINATIM_API_URL=https://nominatim.openstreetmap.org
OSM_USER_AGENT=NearbyHello/0.1 (https://nearbyhello.com)
PLACES_CACHE_TTL_MS=21600000
# Optional secret for POST /v1/internal/spatial/places/sync
SPATIAL_SYNC_SECRET=
# Vision: leave OPENAI_API_KEY empty for the free fixture provider.
OPENAI_VISION_MODEL=gpt-4o-mini
VISION_FIXTURE_MODE=true

SPATIAL_PILOT_LATITUDE=38.9072
SPATIAL_PILOT_LONGITUDE=-77.0369
SPATIAL_PILOT_RADIUS_METERS=1000
```

The public OSM services are appropriate only for a low-volume pilot. Use a
truthful `OSM_USER_AGENT`, retain attribution, follow ODbL/Nominatim/Overpass
policies, and move to a hosted provider or self-hosted extracts before
high-volume traffic.

## API highlights

| Endpoint | Purpose |
|----------|---------|
| `GET/PATCH /v1/spatial/consent` | Granular sensor consent |
| `POST/PATCH /v1/spatial/sessions/:id?` | Start or stop foreground collection |
| `POST /v1/spatial/observations` | Submit a validated supported measurement |
| `GET /v1/spatial/zones` | Resolve the current approximate zone |
| `GET /v1/spatial/aggregates` | Personal, community, or example aggregates |
| `GET /v1/spatial/patterns` | Historical time-bucket patterns |
| `GET /v1/spatial/places/nearby` | Sourced places ordered by distance |
| `GET /v1/spatial/places/search` | Manual location search |
| `POST /v1/spatial/observations` | Submit one authorized image observation |
| `GET /v1/spatial/observations/:id` | Observation processing status |
| `GET /v1/spatial/places/:id/insights` | Published place insights |
| `GET /v1/spatial/places/:id/insights/stream` | SSE insight updates |
| `POST /v1/spatial/query` | Grounded nearby spatial question |
| `POST /v1/spatial/insights/feedback` | Lightweight insight feedback |
| `DELETE /v1/spatial/contributions` | Delete the signed-in user's observations |
| `POST /v1/agent` | Preserved legacy voice turn |
| `GET /v1/matches` | Preserved compatibility endpoint; not in primary UI |

Auth: `Authorization: Bearer <firebase-id-token>` or `Bearer dev` in mock mode.

## Firebase

- Auth: Email/Password
- Firestore rules: `apps/api/firestore.rules`
- Storage rules (profile photos): `apps/api/storage.rules`
- Spatial collections are Admin-SDK-only. Raw observations expire after 30
  days and are never readable directly by clients.
- `spatialPlaces`, `spatialPlaceLookups`, and future `spatialObservations` are
  also Admin-SDK-only. Place lookup documents provide the initial
  fixed-grid/TTL cache; no user-to-place visit history is stored.
- Deploy additive rules/indexes with:

```bash
firebase deploy --only firestore:rules --project ascend-platform-7b5f8
firebase deploy --only firestore:indexes --project ascend-platform-7b5f8
```

## Profile shape

```
users/{uid}
  id, email, name, age, role, interests[]
  photoUrl?, bio?, lookingFor?, vibes[], prompts[]
  deviceId?, avatarHue, initials, createdAt, updatedAt
```

## Platform limitations

- The browser can obtain foreground location and digital microphone
  intensity, but motion support varies and no background sensing is claimed.
- Expo uses foreground location, microphone metering, and accelerometer
  readings. It does not collect while the user has stopped the session.
- dBFS values are uncalibrated, device-dependent digital loudness—not physical
  sound-pressure dB—and cannot be compared reliably across unlike devices
  without a calibration workflow.
- The MVP map is a provider-independent interactive spatial grid. A street-map
  provider is intentionally not a production commitment yet.
- Public Overpass/Nominatim availability and quotas are outside Nearby Hello's
  control. Cached results are returned for up to seven days during transient
  provider failures and are labeled stale.
- Firestore supports the initial fixed-grid/time-window workload. Arbitrary
  polygon joins and large analytical workloads may later justify PostGIS.
- Community insights fail closed below three distinct contributors.
- Historical patterns require at least three samples in a matching time
  bucket.
- Retention timestamps are stored, but production Firebase TTL configuration
  or a scheduled purge must be enabled before community rollout.
