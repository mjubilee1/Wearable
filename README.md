# Nearby

Monorepo for a social proximity product. People nearby (~40–50 ft) show up as matches with a wearable score light — **no mic, no voice, just proximity.**

## Layers

1. **Apps** — rich voluntary profiles (photo, bio, prompts) + “Help me say hi” facilitator
2. **API** — compatibility score + optional LLM icebreakers
3. **Hardware** — BLE walk-by ring (Stage 1 RSSI bar → Stage 2/3 real score)

## Stage 1 firmware

Two Seeed XIAO nRF52840 boards + WS2812 16-LED rings: BLE mutual detection and a walk-by LED bar.

→ [`firmware/stage1-ble-ring/`](firmware/stage1-ble-ring/) — **PlatformIO only** (skip Arduino IDE). NeoPixel + Bluefruit BLE are already in `platformio.ini`.

```bash
cd firmware/stage1-ble-ring
pio run -e xiaoble -t upload          # or -e xiaoblesense
pio device monitor -e xiaoble -b 115200
```

## Apps

| Package | Path | Role |
|---------|------|------|
| `@nearby/web` | `apps/web` | Next.js web app |
| `@nearby/mobile` | `apps/mobile` | Expo React Native app (BLE ring link onboarding) |
| `@nearby/api` | `apps/api` | Hono API |
| `@nearby/shared` | `packages/shared` | Types, scoring, mock facilitator |

### Phone BLE bridge (Stage 2)

- **Phone only** scans BLE (Expo dev build + `react-native-ble-plx`). Website never uses Web Bluetooth.
- Foreground scan matches manufacturer `FF FF | N B | id[4]`, EMA-smooths RSSI, `POST /v1/ble/sightings` (clip id + RSSI + timestamp — no names).
- Backend marks **close** / **green** (close + shared interests). Other person only sees color, not your name.
- Web debug: [`/debug/ble`](apps/web) — last reports for your account (clip id, RSSI, close/green).

```bash
cd apps/mobile && npx expo run:ios   # or run:android — not Expo Go
```

## Setup

```bash
pnpm install
pnpm dev          # web :3000 + api :4000
pnpm dev:mobile   # Expo
```

Copy env files from each app’s `.env.example`. Optional `OPENAI_API_KEY` on the API enables real icebreakers (otherwise mock).

## API highlights

| Endpoint | Purpose |
|----------|---------|
| `GET /v1/matches` | Nearby profiles + scores |
| `POST /v1/facilitate` | Why you vibe + 3 icebreakers |
| `GET /v1/devices/:id?band=0\|1\|2` | Wearable ID → profile + walk-by score |

Auth: `Authorization: Bearer <firebase-id-token>` or `Bearer dev` in mock mode.

## Firebase

- Auth: Email/Password
- Firestore rules: `apps/api/firestore.rules`
- Storage rules (profile photos): `apps/api/storage.rules`

## Profile shape

```
users/{uid}
  id, email, name, age, role, interests[]
  photoUrl?, bio?, lookingFor?, vibes[], prompts[]
  deviceId?, avatarHue, initials, createdAt, updatedAt
```
