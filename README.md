# Nearby Hello

A privacy-first hyperlocal spatial intelligence platform. Nearby Hello uses
permission-based foreground sensors, approximate spatial zones, environmental
measurements, and historical patterns to help people understand the physical
space around them.

Product: [`nearby-product-and-icp.md`](nearby-product-and-icp.md). Architecture
and migration plan: [`NEARBY_REFACTOR_PLAN.md`](NEARBY_REFACTOR_PLAN.md).

## Spatial MVP

1. **Nearby** — current approximate zone, environmental measurements,
   freshness, confidence, and personal collection controls.
2. **Explore** — interactive privacy-preserving spatial grid and nearby zones.
3. **Patterns** — personal or privacy-thresholded historical time buckets.
4. **Profile** — account, contribution management, and preserved legacy
   messaging/voice tools.

Data modes:

- **Demonstration:** visibly synthetic observations for an immediate
  zero-user experience.
- **Personal:** only the signed-in user's foreground measurements.
- **Community:** aggregate insights available only at three or more distinct
  contributors.

Sound is relative intensity, not calibrated decibels. Raw audio is never
uploaded and temporary mobile recordings are deleted locally. Activity is
participating-device motion only, never occupancy or pedestrian counts.

Existing voice, messaging, connectors, authentication, and firmware remain in
the repository for future integration but are not primary navigation.

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
```

These defaults configure the labeled demonstration viewport only; spatial
domain logic is not DC-specific.

## API highlights

| Endpoint | Purpose |
|----------|---------|
| `GET/PATCH /v1/spatial/consent` | Granular sensor consent |
| `POST/PATCH /v1/spatial/sessions/:id?` | Start or stop foreground collection |
| `POST /v1/spatial/observations` | Submit a validated supported measurement |
| `GET /v1/spatial/zones` | Resolve the current approximate zone |
| `GET /v1/spatial/aggregates` | Personal, community, or demonstration aggregates |
| `GET /v1/spatial/patterns` | Historical time-bucket patterns |
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

- The browser can obtain foreground location and relative microphone
  intensity, but motion support varies and no background sensing is claimed.
- Expo uses foreground location, microphone metering, and accelerometer
  readings. It does not collect while the user has stopped the session.
- Relative sound values are device-dependent and cannot be compared as
  calibrated decibels without a calibration workflow.
- The MVP map is a provider-independent interactive spatial grid. A street-map
  provider is intentionally not a production commitment yet.
- Firestore supports the initial fixed-grid/time-window workload. Arbitrary
  polygon joins and large analytical workloads may later justify PostGIS.
- Community insights fail closed below three distinct contributors.
- Historical patterns require at least three samples in a matching time
  bucket.
- Retention timestamps are stored, but production Firebase TTL configuration
  or a scheduled purge must be enabled before community rollout.
