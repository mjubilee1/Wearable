# Nearby (nearbyhello.com): current product

Last updated Fri Oct 16, 2026. Paste into Cursor as context. This replaces the Oct 9 color-clip brief. Those color-clip locks no longer apply.

## What Nearby is now

A voice-first wearable AI assistant: hands-free access to an agent through the day without pulling out your phone. You speak, and it understands, uses tools, does the task, and answers out loud.

Immediate goal: a working proof of concept Montrell uses every day. Practical function over polished hardware.

Domain: [nearbyhello.com](https://www.nearbyhello.com) (bought Oct 11 2026 on Namecheap, pointed at Vercel). The name was chosen so the product can start as a personal assistant and grow into a social, "say hello to people nearby" product later. The social layer is not in scope for this phase.

## Hardware

- Desk board (Oct 16 2026): Seeed XIAO nRF52840 Sense. The Mac reports USB `2886:8045`. This is the same module Omi's devkit firmware targets (`seeed_xiao_nrf52840_sense`). Flash `firmware/wakeword` with `-e xiaoblesense`. The onboard PDM mic stays local until "hello nearby" or the D1 button. The old QT Py Wi-Fi sketch is removed.
- On order (Amazon): I²S MEMS microphone module, 1.28" round GC9A01 SPI display, plus parts for assembly. Confirm the exact models and pinouts before writing wiring.
- Have: laptop, AirPods / Bluetooth headphones, breadboard.
- Constraint: the ESP32-S3 cannot connect to AirPods as a Bluetooth Classic audio headset. Design around it: AirPods go through the laptop or phone, not the board.
- **Wearable form (Oct 11 2026):** necklace / pendant for the first physical prototype — cheaper and easier than a watch (looser enclosure, bigger battery, mic can face up). Not a polished consumer shell yet. Watch is not the V1 target.
- Retired: the Seeed XIAO nRF52840 color-ring firmware under `firmware/`. Leave it in place; don't extend it.

## Architecture (modular, loosely coupled)

| Layer | What it is | Phase 1 |
|---|---|---|
| Input | laptop mic / AirPods via laptop or phone / ESP32-S3 I²S mic | laptop mic or AirPods |
| Voice | wake word, speech-to-text, text-to-speech | laptop |
| Agent | reasoning, tool selection, orchestration, context and memory | API |
| Integrations | calendar, reminders, notes, search, other approved tools | API |
| Device | XIAO nRF52840 Sense wake word | `firmware/wakeword` on the desk board |
| Companion | phone and web Talk screen: one turn, spoken reply, the request runs the tool | now |

Key design choice: the agent lives in the API behind one endpoint (for example `POST /v1/agent`). Every input calls the same endpoint: the laptop now, the ESP32 later, the phone after that. Swapping inputs never means rewriting the agent.

## Existing repo (github.com/mjubilee1/Wearable)

Reuse what works. Don't rebuild it.

- `apps/api`: Hono API with Firebase auth (`Bearer <firebase-id-token>`, `Bearer dev` in mock mode). Already calls OpenAI (`OPENAI_API_KEY`). Home for the agent.
- `packages/shared`: shared types. Put the device and agent API contract here.
- `apps/mobile`: Expo app (dev build). Future companion.
- `apps/web`: Next.js. Can become a simple status and settings page.
- Set aside: BLE color matching, `/v1/matches`, `/v1/ble/sightings`, ring firmware. Leave them alone; don't delete them in this pass.

## Rules

- Don't put permanent API secrets in firmware. Devices authenticate to the backend; the backend holds the model keys.
- Short, useful spoken replies.
- A spoken request runs the tool in that turn. Nearby does not record the room, and it does not ask again before a note, reminder, memory, or calendar check. A saved fact can be deleted.
- Log errors and handle them clearly at every layer.
- Don't optimize the enclosure, industrial design, manufacturing, or battery yet.
- The color-clip BLE scan is off in the phone and the website. Leave `/v1/matches` and `/v1/ble/sightings` in the API. Don't put the scan UI back.
- Leave the color-ring sketches alone. New XIAO voice code goes in `firmware/wakeword`.
- Third-party software is a reference. `third_party/omi` is read-only. Borrow a pinout or idea only after it passes the Nearby rules: no room recording, no model keys in firmware, one spoken turn, color-ring sketches left in place. Omi's always-on capture, Opus stream, SD storage, and devkit speaker do not get copied in as the firmware to flash. Use `.cursor/skills/third-party-nearby/SKILL.md`.

## Priorities (in order)

1. End-to-end function
2. Low latency
3. Reliable voice in and out
4. Useful tool execution
5. Modular architecture
6. Low-cost hardware
7. Battery and portability

## Milestones

- **M1, working voice agent:** speak through the laptop, the phone, or AirPods and get a spoken answer. Current target. The phone types the turn until the next dev build grows a microphone button. The website can use the laptop microphone.
- **M2, useful actions:** at least 3 tasks work — Google Calendar (read today), plus an in-app note and reminder. Calendar OAuth lives in `apps/api` (`/v1/connectors/google/calendar`).
- **M3, ESP32 talks to the backend:** Wi-Fi, a request to the backend, a valid response.
- **M4, physical voice prototype:** audio from the I²S mic reaches Nearby and gets a response.
- **M5, wearable interaction:** the round display shows status and output. Evaluate size, power, and portability.
- **M6, daily-use pilot (7 to 14 days):** track useful interactions per day, tasks completed, voice accuracy, latency, connectivity failures, times you still reached for the phone, and which features you kept coming back to.

## Build order now

1. Audit the repo and list what's implemented and reusable.
2. Propose the minimum viable architecture.
3. Build the fastest path to the laptop/AirPods voice loop: listen, speech-to-text, `/v1/agent`, text-to-speech.
4. Create a new ESP32-S3 firmware project with Wi-Fi provisioning and backend calls, using a mock mic and serial output.
5. Define a clean device-to-backend API contract in `packages/shared`.
6. Stub the mic and display modules so they're ready when the parts arrive.
7. Write an implementation order with a testable acceptance check for each step.
8. Ship M1 end to end.

## Daily-use scenarios to design for

- **Morning:** today's agenda, meetings and reminders, a short task summary, follow-ups without repeating context.
- **At work:** capture ideas or notes by voice, create tasks and reminders, ask technical questions, pull info from approved integrations.
- **Commute or walk:** hands-free through headphones, capture thoughts without opening an app, spoken answers, calendar and reminders.
- **All day:** remembers facts you asked it to keep, runs a supported tool when you ask, keeps answers short.

## Market context (scenarios only, Oct 11 2026)

The space is crowded, and several products have failed. Humane's Pin was disabled Feb 28 2025 after returns outpaced sales, and HP bought the platform, patents, and staff. Rabbit is no longer made. Limitless stopped selling after Meta bought it. Bee is now inside Amazon. Still shipping or upcoming: Plaud (about 2M devices), Omi, Friend, Button ($179 preorder, ships Dec 2026), Sandbar Stream ring, Flic Cue, and an OpenAI device. Market size estimates swing widely with assumed adoption, so they aren't a plan yet.

### Lessons from recent failures (design against these)

- **Rabbit R1:** Sold a new shell around a phone job. Demo wow, daily shrug. Slow cloud gimmicks and a worse app in a box. Nearby does not ship hardware until the laptop/AirPods loop is something Montrell actually uses.
- **Omi:** Wearable as always-on recorder / meeting capture. Privacy creep and "is that thing listening?" in a room. Nearby is not a recorder. It acts when you speak to it, then stops.
- **Friend:** Companion necklace — chat for its own sake, emotional product, unclear task. Nearby is not a friend in your ear. Short spoken answers for real tasks, then silence.
- **Shared failure mode:** Marketing a vibe and a form factor before a daily job. Nearby's order is function → voice reliability → useful tools → then a device people might wear.

Public marketing should say what we refuse (phone-in-a-box, companion, recorder) without trash-talking competitors by name on the homepage.

Posted links include the channel so the waitlist `source` shows where the signup came from: `https://www.nearbyhello.com/?utm_source=instagram`, `?utm_source=tiktok`, or `?utm_source=linkedin`. A visit with no `utm_source` is stored as `marketing`.

## Still to decide

Do not invent: who buys it, device only or a subscription, the price, press-to-talk vs. always listening, or the one job it does better than a phone plus AirPods plus ChatGPT voice. The M6 pilot is the real test.
