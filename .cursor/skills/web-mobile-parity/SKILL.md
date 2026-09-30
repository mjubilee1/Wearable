---
name: web-mobile-parity
description: >-
  Keep Nearby web (apps/web) and mobile (apps/mobile) product surfaces 1:1.
  Use when adding or changing screens, flows, copy, CTAs, auth, matches,
  connections, profile, design tokens, or shared domain logic across clients;
  when the user mentions parity, mirror web, or mobile matching the web app.
---

# Web ↔ Mobile Parity

Nearby’s **web app is the product source of truth**. Mobile should mirror the same screens, flows, copy, CTAs, and data rules — with platform-native chrome only where required (navigation bars, safe areas, BLE/Scan).

## When this skill applies

- Any feature work in `apps/web` or `apps/mobile`
- Changes to `@nearby/shared` types, scoring, option banks, or API contracts
- Auth, matches, facilitate/hello, connections, profile, or tab IA changes

## Non-negotiables

1. **Same IA** — Tabs: Nearby · Connections · Activity · Profile. Auth routes: login, signup, forgot-password. Do not invent mobile-only product tabs that replace these (Scan/BLE is additive, not a substitute for Connections).
2. **Same identity & data** — Firebase Auth + Firestore profiles/connections. No `Bearer dev` in shipped flows. API calls use real ID tokens.
3. **Domain logic lives in `@nearby/shared`** — Types, scoring (`compatibilityScore`, `walkByScore`), sanitize helpers, option banks (`VIBE_OPTIONS`, `LOOKING_FOR_OPTIONS`, prompts, interests). Never fork rules between clients.
4. **Same copy & CTAs** — Match web wording (`Help me say hi`, `Send a hello`, Connections subtabs Incoming/Sent/Connected, accept/decline/cancel/block).
5. **Same design tokens** — Port hex values from `apps/web/src/app/globals.css` `@theme`:
   - teal `#0d9488`, teal-soft `#ccfbf1`
   - coral `#f97066`, coral-soft `#fee4e2`
   - ink `#111827`, muted `#6b7280`
   - surface `#f3f4f6`, card `#ffffff`, amber-glow `#f59e0b`
6. **Same card hierarchy** — photo → name/age/role/bio → interest/vibe chips → compatibility score → primary actions.

## Canonical references (web)

| Concern | Look here first |
|---|---|
| Nearby / facilitate / hello | `apps/web/src/components/NearbyMatches.tsx`, `HelloComposer.tsx`, `ProfileCard.tsx`, `CompatibilityScore.tsx`, `DeviceStrip.tsx` |
| Connections | `apps/web/src/app/connections/page.tsx`, `apps/web/src/lib/connections.ts` |
| Profile | `apps/web/src/app/profile/page.tsx`, `apps/web/src/lib/users.ts`, `storage.ts` |
| Auth | `apps/web/src/lib/auth-context.tsx`, `AuthGate.tsx`, `login`/`signup`/`forgot-password` pages |
| Tabs | `apps/web/src/components/TabBar.tsx` |
| Shared domain | `packages/shared/src/index.ts` |
| Tokens | `apps/web/src/app/globals.css` |

Mobile lives under `apps/mobile/` (today largely `App.tsx` — split to mirror web routes as parity lands).

## Workflow for every change

Copy and track:

```
Parity checklist:
- [ ] Web behavior identified (files above)
- [ ] Shared domain updated in @nearby/shared if rules/types changed
- [ ] Mobile screen/flow updated to match (or explicit deferral noted)
- [ ] Copy/CTAs match web
- [ ] Tokens/visual hierarchy match
- [ ] Auth/token path is real Firebase ID token (not Bearer dev)
```

### Adding a feature

1. Implement (or confirm) on **web** as the reference UX.
2. Extract any pure logic/types/options into `@nearby/shared`.
3. Implement the **same** flow on mobile with RN primitives (not a simplified stub).
4. If shipping web-only temporarily, leave a short `// PARITY: mobile — <what>` comment at the web call site and mention it in the PR/summary.

### Changing an existing flow

1. Diff against the web component/page first.
2. Update shared package before either client if domain rules change.
3. Apply the same state machine and edge cases on both (empty, loading, error, blocked, cooldown).

### Mobile-only affordances

Allowed: BLE/Scan device lookup, haptics, push, native share, safe-area layout.
Not allowed: different match/connection rules, different auth model, omitting Connections/Profile while claiming parity.

## Anti-patterns

- Hardcoding `Bearer dev` or seeding-only UX as the permanent mobile path
- Duplicating scoring/connection rules in `App.tsx` instead of `@nearby/shared`
- Replacing Connections with Scan in the main tab bar
- Divergent colors, score thresholds, or CTA labels “just for mobile”
- Shipping a web feature without a mobile counterpart or an explicit `PARITY:` deferral

## Current known gap (update as parity lands)

Mobile now mirrors web IA via Expo Router: Firebase auth (login/signup/forgot-password), tabs Nearby · Connections · Activity · Profile, HelloComposer, facilitate with ID tokens, Connections subtabs, and profile editor + photo upload.

Still softer than web (polish only): walk-by DeviceStrip animation fidelity, Plus Jakarta typography, and optional Scan/BLE as a mobile-only additive surface (not a tab replacement).
