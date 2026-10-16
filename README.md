# Nearby

A voice-first wearable AI assistant. You speak, it uses tools, and it answers out loud. Current target is a spoken turn through the laptop, the phone, or AirPods (`POST /v1/agent`). Domain: [nearbyhello.com](https://www.nearbyhello.com).

Product: [`nearby-product-and-icp.md`](nearby-product-and-icp.md) (Fri Oct 16, 2026). The Oct 9 color-clip brief is retired. The social hello layer is later.

## Layers

1. **Input** — laptop mic on the website, typed turn on the phone (spoken reply). The XIAO mic stays on the board until "hello nearby" or the D1 button. AirPods do not pair to the board.
2. **Agent** — `apps/api` `POST /v1/agent`. A spoken request runs the tool in that turn. A saved fact can be deleted.
3. **Device** — The board on the desk is a Seeed XIAO nRF52840 Sense. Flash [`firmware/wakeword`](firmware/wakeword/) with `-e xiaoblesense`. The older color-ring sketches under `firmware/` stay in place and are not extended. Omi under `third_party/omi` is a read-only reference.

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
| `POST /v1/agent` | One spoken turn. A selected tool runs in that request. |
| `GET /v1/agent/memories` | Facts the user asked to keep |
| `DELETE /v1/agent/memories/:id` | Drop a saved memory |
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
