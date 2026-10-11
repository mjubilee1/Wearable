# Nearby

A voice-first wearable AI assistant. You speak, it uses tools, and it answers out loud. Current target is a laptop or AirPods voice loop (`POST /v1/agent`). Domain: [nearbyhello.com](https://www.nearbyhello.com).

Product: [`nearby-product-and-icp.md`](nearby-product-and-icp.md) (Sun Oct 11, 2026). The Oct 9 color-clip brief is retired. The social hello layer is later.

## Layers

1. **Input** — laptop mic or AirPods now. ESP32-S3 I²S mic when the parts arrive. AirPods do not pair to the board.
2. **Agent** — `apps/api`, one endpoint every input calls. Tools only with permission.
3. **Device** — new ESP32-S3 firmware later. The Seeed XIAO color-ring tree under `firmware/` stays in place and is not extended.

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

### Phone BLE bridge (Stage 2 → phone-driven LED)

- **Phone only** scans BLE (Expo dev build + `react-native-ble-plx`). Website never uses Web Bluetooth.
- Foreground scan matches manufacturer `FF FF | N B | id[4]`, EMA-smooths RSSI, `POST /v1/ble/sightings` (clip id + RSSI + timestamp — no names).
- Backend marks **close** / **green** (close + shared interests). Other person only sees color, not your name.
- When API returns **green**, the phone GATT-writes the wearer’s **own** linked clip (`clip-phone-led` firmware). Rings do not green from peer RSSI.
- Web debug: [`/debug/ble`](apps/web) — last reports for your account (clip id, RSSI, close/green).

```bash
pnpm fw:clip                 # flash phone-driven LED firmware (both boards)
cd apps/mobile && pnpm ios --device   # physical phone; not Expo Go
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
