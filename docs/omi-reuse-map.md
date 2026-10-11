# Omi reuse map (Nearby)

Pinned clone: `third_party/omi` @ `61d26a1d1e6f25d8d9fd7339e2a0ccf163358f26`  
Source: [github.com/BasedHardware/omi](https://github.com/BasedHardware/omi) (MIT)  
Commit file: `third_party/OMI_COMMIT.txt`

**Rules for this tree:** read-only. Never edit `third_party/omi`. After approval, copy only selected files into `src/vendor/omi/<piece>/` with MIT headers; keep Nearby code outside `third_party/` and `vendor/`, calling vendored code through a thin wrapper. Do not pull Omi Firebase, cloud keys, or its full app/backend services.

**Nearby context:** voice-first assistant. M1 = laptop / AirPods → `POST /v1/agent`. Later = Adafruit QT Py ESP32-S3 (I²S mic, GC9A01) streaming audio to the phone over BLE. Omi firmware is **nRF5340 + Zephyr / nRF Connect SDK** and a **PDM** mic — not ESP32, not Arduino, not I²S.

Port difficulty key: **Easy** / **Medium** / **Hard** / **Rewrite** (reuse ideas only).

---

## Ranked by value for Nearby

| Rank | Piece | Value for us | Port difficulty | When |
|------|--------|--------------|-----------------|------|
| 1 | BLE audio protocol + packet framing | Highest — shared contract device ↔ phone | Easy (spec) | Before any BLE stream |
| 2 | React Native device SDK (`OmiConnection` + codecs) | Highest for Expo phone companion | Medium | Phone BLE phase |
| 3 | Opus encode settings + opus-1.2.1 tree | High — fits BLE bandwidth | Medium (ESP-IDF opus / libopus) | Device firmware |
| 4 | Firmware codec pipeline (`codec.c` / `codec.h`) | High as reference for PCM→Opus→callback | Hard (strip Zephyr) | Device firmware |
| 5 | Firmware BLE transport (`transport.c`) | High as reference for GATT notify + MTU | Hard (NimBLE/Bluedroid rewrite) | Device firmware |
| 6 | Python / TS device SDKs (decode + listen) | High for laptop harness / parity tests | Easy–Medium | M1 tools + BLE bring-up |
| 7 | Flutter app BLE receive path | Medium — logic to mirror, not copy whole app | Medium (Dart→TS/RN) | Phone BLE phase |
| 8 | Backend listen / STT pipeline shape | Medium as architecture notes only | Hard / Rewrite | After M1; no Omi cloud |
| 9 | Backend memory / conversation graph | Low — Nearby is not a recorder/companion | Rewrite / skip | Out of scope |
| 10 | Mic, LED, SD, battery, storage firmware | Low — wrong chip and peripherals | Rewrite | Own I²S + display drivers |
| 11 | Full Flutter app / desktop / Firebase | Do not reuse | — | — |

---

## 1. BLE audio protocol and packet format

**What it is:** Canonical GATT UUIDs, codec IDs, and the 3-byte notify header.

| Path | Role |
|------|------|
| `third_party/omi/sdks/device/PROTOCOL.md` | Shared contract for all device SDKs |
| `third_party/omi/omi/firmware/omi/src/lib/core/config.h` | Opus @ 16 kHz, `CODEC_ID 21`, frame samples |
| `third_party/omi/omi/firmware/omi/src/lib/core/transport.c` | Builds `[id_lo, id_hi, index][payload…]`, MTU chunking |
| `third_party/omi/app/lib/services/audio_sources/ble_device_source.dart` | Strips 3-byte header; documents framing |
| `third_party/omi/app/lib/backend/schema/bt_device/bt_device.dart` | `BleAudioCodec` enum / frame parity |

**Wire format (notify on audio data char):**

```
[packet_id_low][packet_id_high][packet_index][codec payload…]
```

- Header size: **3 bytes** (`NET_BUFFER_HEADER_SIZE`)
- Default useful codec for CV1 firmware: **Opus ID `21` / `0x15`**, 320 samples/frame (20 ms) @ 16 kHz mono → PCM 16-bit LE after decode
- DevKit uses Opus ID `20` / `0x14` with 160-sample (10 ms) frames — do not mix assumptions

**GATT (from PROTOCOL.md):**

| Role | UUID |
|------|------|
| Audio service | `19b10000-e8f2-537e-4f6c-d104768a1214` |
| Audio data (notify) | `19b10001-e8f2-537e-4f6c-d104768a1214` |
| Audio codec (read) | `19b10002-e8f2-537e-4f6c-d104768a1214` |
| Battery service | `0000180f-0000-1000-8000-00805f9b34fb` |

**Dependencies:** None to adopt the spec; firmware/SDK must agree on the same UUIDs and header.

**ESP32-S3 port:** **Easy** for the contract (document + constants in `packages/shared`). No Zephyr code required. Strongly recommended as the first approved piece so phone and device stay compatible.

**Nearby note:** Prefer **our own service UUID namespace** eventually (Omi’s comment in `transport.c` says the Intel-era UUID should change). For bring-up, matching Omi’s framing speeds phone SDK reuse; product UUID can diverge later behind a version byte.

---

## 2. Audio codec (Opus) and encode path

| Path | Role |
|------|------|
| `third_party/omi/omi/firmware/omi/src/lib/core/codec.h` | Callback + `codec_receive_pcm` / `codec_start` API |
| `third_party/omi/omi/firmware/omi/src/lib/core/codec.c` | Ring buffer, Zephyr thread, `opus_encode` |
| `third_party/omi/omi/firmware/omi/src/lib/core/config.h` | Bitrate 32 kbps, complexity 3, VBR, 320-sample packages |
| `third_party/omi/omi/firmware/omi/src/lib/core/lib/opus-1.2.1/` | Vendored Opus 1.2.1 sources + CMake |
| `third_party/omi/omi/firmware/devkit/src/` (config + codec if present) | DevKit 10 ms frame variant |

**What it does:** PCM int16 frames in → Opus bytes out → callback into transport.

**Dependencies:** Opus 1.2.1; Zephyr `ring_buf`, threads, semaphores; `CONFIG_OMI_CODEC_OPUS`.

**ESP32-S3 port:** **Medium–Hard**. The Opus C sources are portable; the wrapper is Zephyr-specific. On ESP32 prefer ESP-IDF’s opus component or libopus, FreeRTOS queue instead of `k_sem` / `ring_buf`. Keep Omi’s **encode settings** (16 kHz mono, ~32 kbps, complexity 3, frame size) even if the wrapper is rewritten. I²S mic → PCM is **our** driver, not Omi’s PDM `mic.c`.

---

## 3. BLE audio streaming firmware (transport)

| Path | Role |
|------|------|
| `third_party/omi/omi/firmware/omi/src/lib/core/transport.c` | GATT services, connect/MTU/PHY, audio notify pusher thread |
| `third_party/omi/omi/firmware/omi/src/lib/core/transport.h` | Transport API surface |
| `third_party/omi/omi/firmware/omi/src/main.c` | Boot / feature wiring |
| `third_party/omi/omi/firmware/omi/src/lib/core/features.h` | Feature flags |
| `third_party/omi/omi/firmware/test/src/ble_throughput*.c` | Throughput test patterns |
| `third_party/omi/omi/firmware/omi/readme.md` / `BUILD_AND_OTA_FLASH.md` | Zephyr / nRF build |

**What it does:** Advertises, negotiates MTU (up to ~517), chunks Opus frames into 3-byte-header notifies, throttles TX so control notifies still work.

**Dependencies:** Zephyr Bluetooth (`bt_gatt_notify_cb`, BAS, NUS shell), nRF HAL, optional SD storage / charging / haptic — tightly coupled.

**ESP32-S3 port:** **Hard / mostly Rewrite**. Reuse: UUID table, header layout, MTU-aware chunking, retry/throttle ideas. Replace: entire BLE stack with **NimBLE (ESP-IDF)** or Arduino BLE. Do **not** try to compile `transport.c` under Arduino as-is.

---

## 4. Microphone firmware (low reuse)

| Path | Role |
|------|------|
| `third_party/omi/omi/firmware/omi/src/mic.c` | nRF PDM (`nrfx_pdm` / Zephyr DMIC), 16 kHz |
| `third_party/omi/omi/firmware/omi/src/lib/core/mic.h` | Callback API |
| `third_party/omi/omi/firmware/devkit/src/mic.c` | DevKit mic variant |
| `third_party/omi/omi/firmware/omi/src/t5838_aad.c` | Optional always-on acoustic activity |

**ESP32-S3 port:** **Rewrite**. Nearby uses **I²S MEMS**, not PDM on nRF. Keep only the idea: deliver int16 PCM @ 16 kHz into the codec callback.

---

## 5. Phone app — BLE connection and audio receive

### 5a. React Native SDK (best fit for `apps/mobile`)

| Path | Role |
|------|------|
| `third_party/omi/sdks/react-native/src/OmiConnection.ts` | Scan, connect, codec read, audio notify subscribe (`react-native-ble-plx`) |
| `third_party/omi/sdks/react-native/src/codecs.ts` | Codec name helpers |
| `third_party/omi/sdks/react-native/src/types.ts` | `BleAudioCodec`, connection state |
| `third_party/omi/sdks/react-native/omi_connection_doc.md` | UUID + API notes |
| `third_party/omi/sdks/react-native/README.md` | Package usage |
| `third_party/omi/sdks/react-native/package.json` | Declares `react-native-ble-plx` |

**Dependencies:** `react-native-ble-plx` (Nearby already uses this). No Firebase in this thin SDK.

**Port:** **Medium**. Copy/adapt into `src/vendor/omi/react-native-ble/` or wrap from `apps/mobile` — strip package name coupling, map codec ID **21**, strip 3-byte header, request large MTU on Android.

### 5b. Flutter app (reference only — do not vendor whole app)

| Path | Role |
|------|------|
| `third_party/omi/app/lib/services/devices/connectors/omi_connection.dart` | Full production connector (custody, storage, audio gates) |
| `third_party/omi/app/lib/services/devices/connectors/device_connection.dart` | Base connection |
| `third_party/omi/app/lib/services/devices/transports/native_ble_transport.dart` | Native BLE transport (if present) |
| `third_party/omi/app/lib/services/audio_sources/ble_device_source.dart` | Header strip + WAL sync keys |
| `third_party/omi/app/lib/services/bridges/ble_bridge.dart` | Bridge into capture pipeline |
| `third_party/omi/app/lib/backend/schema/bt_device/bt_device.dart` | Codec / device schema |

**Port:** **Medium** as a checklist; **Hard** if copying. Prefer RN SDK + PROTOCOL.md. Flutter path is entangled with Omi capture/WAL/onboarding.

---

## 6. Device SDKs (decode / laptop harness)

| Path | Role |
|------|------|
| `third_party/omi/sdks/device/PROTOCOL.md` | Spec |
| `third_party/omi/sdks/device/PARITY.md` | Cross-SDK parity notes |
| `third_party/omi/sdks/device/STT.md` | Device↔STT notes |
| `third_party/omi/sdks/python/omi/decoder.py` | Strip header + Opus decode |
| `third_party/omi/sdks/python/omi/bluetooth.py` / `ble.py` | Python BLE client |
| `third_party/omi/sdks/device/typescript/` | TS device client |
| `third_party/omi/sdks/swift/` | Swift client |
| `third_party/omi/sdks/rust/` | Rust client |
| `third_party/omi/sdks/device/cpp/` | C++ client |

**Value:** **Easy–Medium** for a Mac-side “listen to ESP32 Opus stream” tool during bring-up. Good before wiring Expo. Do not pull python-cli cloud auth flows.

---

## 7. Backend transcription and memory (ideas only)

| Path | Role |
|------|------|
| `third_party/omi/backend/routers/listen/` | `/v4/listen` WebSocket entry |
| `third_party/omi/backend/docs/listen_pusher_pipeline.mdx` | End-to-end listen + pusher design |
| `third_party/omi/backend/utils/listen_audio.py` | Audio session helpers |
| `third_party/omi/backend/utils/listen_pusher_session.py` | Pusher session |
| `third_party/omi/backend/pusher/` | Realtime fan-out service |
| `third_party/omi/backend/routers/transcribe.py` / `stt.py` | Transcription routes |
| `third_party/omi/backend/utils/stt/` | STT provider wiring |
| `third_party/omi/backend/parakeet/` | Hosted ASR bits |
| `third_party/omi/backend/utils/memory/` | Large memory/graph system |
| `third_party/omi/backend/config/live_stt_*.py` | Live STT policy |

**What it does:** Phone/desktop sends audio over WebSocket → VAD/STT/diarization → conversations → memory extraction. Deeply tied to **Omi Firebase, GPU workers, Soniox/Parakeet, pusher**.

**Port:** **Rewrite**. Useful as a **sequence diagram** for “audio bytes in → text out.” Nearby should stay on `apps/api` + OpenAI (or a chosen STT) behind `/v1/agent`. **Do not** vendor Omi’s Firebase, keys, pusher deploy, or memory graph. Product locks: not a recorder, not a companion — so conversation-diary and always-on memory are the wrong default.

---

## 8. Explicitly out of scope (do not copy)

| Area | Paths (examples) | Why |
|------|------------------|-----|
| Full Flutter app | `third_party/omi/app/` | Product UI, Firebase, capture diary |
| Desktop apps | `third_party/omi/desktop/` | Different product surface |
| Firebase / Firestore rules | `third_party/omi/firebase.json`, `firestore.rules` | Cloud lock-in |
| Hardware CAD | `third_party/omi/omi/hardware/` | Different form factor |
| Bootloader / MCUBoot / nRF boards | `third_party/omi/omi/firmware/bootloader/`, `boards/` | nRF5340 only |
| Offline SD storage sync | `storage.c`, custody in `omi_connection.dart` | Not M1; complexity |

---

## Suggested approval order (when you green-light Step 3)

1. **`protocol`** — `PROTOCOL.md` + shared UUID/header/codec constants → `src/vendor/omi/protocol/` (or fold constants into `packages/shared` with attribution).
2. **`react-native-ble`** — thin `OmiConnection` + types/codecs → phone receive path in Expo.
3. **`opus-settings` + opus sources** — encode parameters + library under `src/vendor/omi/opus/` for ESP-IDF firmware.
4. **`codec-reference` / `transport-reference`** — copy only as annotated reference or reimplement under `firmware/esp32-s3-*` from notes in `CHANGES.md`; do not expect Zephyr files to build on ESP32.

**Stop here until a piece is approved.** No files have been copied into `src/vendor/omi/` yet.
