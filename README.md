# Nearby

Monorepo for a social proximity product. People nearby (~40–50 ft) show up as matches with a wearable score light — **no mic, no voice, just proximity.**

## Stage 1 firmware (hardware first)

Two Seeed XIAO nRF52840 boards + WS2812 16-LED rings: BLE mutual detection and a walk-by LED bar (fake local score).

→ [`firmware/stage1-ble-ring/`](firmware/stage1-ble-ring/)

## Apps

| Package | Path | Role |
|---------|------|------|
| `@nearby/web` | `apps/web` | Next.js web app |
| `@nearby/mobile` | `apps/mobile` | Expo React Native app |
| `@nearby/api` | `apps/api` | Hono API (Firebase Admin) |
| `@nearby/shared` | `packages/shared` | Shared types + scoring helpers |

## Stack

- **pnpm workspaces** monorepo
- Next.js 15 + Tailwind CSS v4 (web)
- Expo / React Native (mobile)
- Hono + Firebase Admin (API)
- Firebase Auth + Cloud Firestore
- TanStack Query

## Setup

```bash
pnpm install
```

### Web

```bash
cp apps/web/.env.example apps/web/.env
# fill NEXT_PUBLIC_FIREBASE_*
pnpm dev:web
```

Open [http://localhost:3000](http://localhost:3000).

### API

```bash
cp apps/api/.env.example apps/api/.env
pnpm dev:api
```

Runs on [http://localhost:4000](http://localhost:4000). Without Firebase Admin credentials it serves **mock** match data (`Authorization: Bearer dev`).

### Mobile

```bash
cp apps/mobile/.env.example apps/mobile/.env
pnpm dev:mobile
```

Then press `i` / `a` for simulator, or scan the QR with Expo Go.

### All (web + api in parallel)

```bash
pnpm --filter @nearby/web --filter @nearby/api --parallel run dev
```

## Firebase

In Firebase Console:

- **Authentication → Sign-in method → Email/Password → Enable**
- **Firestore → create database** (paste `apps/api/firestore.rules`)

## Firestore shape

```
users/{uid}
  id, email, name, age, role, interests[], avatarHue, initials, createdAt, updatedAt
```
