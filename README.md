# Nearby

A voice-first wearable AI assistant. You speak, it uses tools, and it answers out loud. Current target is a spoken turn through the laptop, the phone, or AirPods (`POST /v1/agent`). Domain: [nearbyhello.com](https://www.nearbyhello.com).

Product: [`nearby-product-and-icp.md`](nearby-product-and-icp.md) (Sun Oct 11, 2026). The Oct 9 color-clip brief is retired. The social hello layer is later.

## Layers

1. **Input** — laptop mic on the website, typed turn on the phone (spoken reply). ESP32 serial stand-in until the mic arrives. AirPods do not pair to the board.
2. **Agent** — `apps/api` `POST /v1/agent`. Tools only with permission. Memory only after you allow it.
3. **Device** — [`firmware/voice-esp32`](firmware/voice-esp32/). Wi-Fi only. The chip on the desk has no BLE, so `NEARBY_HAS_BLE` stays 0. The older color-ring sketches under `firmware/` stay in place and are not extended.

## Voice firmware

```bash
cd firmware/voice-esp32
cp include/secrets.h.example include/secrets.h
pio run -e qtpy-s2 -t upload
pio device monitor -e qtpy-s2
```

Default board is the Adafruit QT Py ESP32-S2. Use `-e qtpy-s3` or `-e esp32dev` if the silkscreen matches those instead. BLE audio is still off in every env.

## Apps

| Package | Path | Role |
|---------|------|------|
| `@nearby/web` | `apps/web` | Next.js. Talk is `/activity` (laptop microphone). |
| `@nearby/mobile` | `apps/mobile` | Expo. Talk tab types a turn and speaks the reply. |
| `@nearby/api` | `apps/api` | Hono API |
| `@nearby/shared` | `packages/shared` | Types, scoring, agent contract |

## Setup

```bash
pnpm install
pnpm dev          # web :3000 + api :4000
pnpm dev:mobile   # Expo
```

Copy env files from each app’s `.env.example`. Optional `OPENAI_API_KEY` on the API enables real replies (otherwise a short mock).

## API highlights

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/agent` | One spoken turn. A tool waits for `decision`. |
| `GET /v1/agent/memories` | Facts the user approved |
| `DELETE /v1/agent/memories/:id` | Drop an approved memory |
| `GET /v1/matches` | Nearby profiles + scores |
| `POST /v1/facilitate` | Why you vibe + 3 icebreakers |

Auth: `Authorization: Bearer <firebase-id-token>` or `Bearer dev` in mock mode.

## Firebase

- Auth: Email/Password
- Firestore rules: `apps/api/firestore.rules`
- Storage rules (profile photos): `apps/api/storage.rules`
- Approved memories: `agentState/{uid}` when Admin credentials are set

## Profile shape

```
users/{uid}
  id, email, name, age, role, interests[]
  photoUrl?, bio?, lookingFor?, vibes[], prompts[]
  deviceId?, avatarHue, initials, createdAt, updatedAt
```
