# Nearby Stage 1 — BLE walk-by ring

Two **Seeed XIAO nRF52840** boards advertise a short device ID over BLE, scan for each other, and drive a **WS2812 16-LED ring** as a walk-by progress bar (red → orange → green) from a **fake local score** based on RSSI.

No mic. No ESP-NOW. No phone app. No Firebase. No connections / Crossed Paths.

## Hardware

| Part | Qty |
|---|---|
| Seeed XIAO nRF52840 (or Sense) | 2 |
| WS2812 / NeoPixel 16-LED ring | 2 |
| USB-C cables | 2 |

### Pin map (per board)

| Ring wire | XIAO pin | Notes |
|---|---|---|
| **DIN** (data) | **D0** | `NEARBY_NEOPIXEL_PIN=0` — change in `platformio.ini` if needed |
| **VCC** | **5V** | Prefer 5V while USB-powered; WS2812 wants ~5V |
| **GND** | **GND** | Common ground required |

Optional hardening if the ring flickers:

- 300–500Ω series resistor on DIN
- 100–1000µF electrolytic across ring VCC/GND
- Level shifter if 3.3V data into 5V LEDs is unreliable

Brightness defaults to `40/255` to avoid brownouts. Raise with `-DNEARBY_LED_BRIGHTNESS=64`.

## What the firmware does

1. Reads a unique 4-byte ID from `NRF_FICR->DEVICEID[0]` (different on each board automatically).
2. Advertises manufacturer data: `FF FF | 'N' 'B' | id0..id3` plus local name `NB-XXXX`.
3. Scans for the same magic from a **different** device ID (no BLE connection).
4. Maps peer RSSI (−85 → −45 dBm) to score 0–100 with light smoothing.
5. Lights LEDs `0..N` as a progress bar; color shifts red → orange → green.
6. Alone: dim blue breath on LED 0 (alive indicator).

Flash the **same** firmware to both boards.

## Tooling (PlatformIO only)

Use **PlatformIO** — not the Arduino IDE. Board target, Adafruit NeoPixel, and Bluefruit BLE are already set in `platformio.ini`.

Install [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation.html) (CLI) or the Cursor/VS Code PlatformIO extension.

This project uses the **Adafruit nRF52 / Bluefruit** board target (`xiaoble_adafruit` / `xiaoblesense_adafruit`), not the mbed Seeed target — required for concurrent advertise + scan.

What’s already configured in `platformio.ini`:

| Piece | Setting |
|---|---|
| Board | Seeed XIAO nRF52840 → `xiaoble` (or `xiaoblesense`) |
| BLE | Bluefruit (bundled with Adafruit nRF52 core) |
| LEDs | `adafruit/Adafruit NeoPixel` |
| DIN pin | `NEARBY_NEOPIXEL_PIN=0` (D0) |

## Build & upload

```bash
cd firmware/stage1-ble-ring

# Non-Sense XIAO nRF52840
pio run -e xiaoble              # build
pio run -e xiaoble -t upload    # flash (board plugged in)

# Sense variant
pio run -e xiaoblesense -t upload
```

Upload board A, unplug, plug board B, upload again.

If upload hits the wrong port (earbuds, etc.) or times out:

1. Use a **USB-C data** cable
2. Double-tap **RESET** to enter the bootloader
3. Pass the port explicitly:  
   `pio run -e xiaoble -t upload --upload-port /dev/cu.usbmodem…`

Serial monitor:

```bash
pio device monitor -e xiaoble -b 115200
```

You should see lines like:

```text
Nearby Stage 1 — BLE walk-by ring
Advertising as NB-A1B2
Device ID ...
peer rssi=-62 score=58
```

## Demo (two boards)

1. Power both boards (USB). Confirm each has a slow blue breath on LED 0.
2. Hold them ~2–5 m apart — bar should stay low / off.
3. Walk them toward each other. Bars should fill and shift orange → green as RSSI improves.
4. Separate them — bars fade back to the idle breath.

That’s the Stage 1 physical moment: **mutual recognition + shared progress signal**.

## Tuning

Edit `include/config.h` or `build_flags` in `platformio.ini`:

| Knob | Effect |
|---|---|
| `RSSI_FAR_DBM` / `RSSI_NEAR_DBM` | Distance → score mapping |
| `PEER_STALE_MS` | How long after last advert before fade-out |
| `NEARBY_LED_BRIGHTNESS` | Ring brightness |
| `NEARBY_NEOPIXEL_PIN` | DIN pin (default D0) |

## Out of scope (later) — now tracked in monorepo

- **Stage 2 (app bridge):** phone foreground-scans manufacturer `FF FF|NB|id[4]`, `POST /v1/ble/sightings` (clip id + RSSI only). Web `/debug/ble` shows those reports — no Web Bluetooth, no names in the walk-by path.
- **Stage 3 (real score on ring):** API `walkByScore(self, other, proximityBand)` = profile compatibility gated by RSSI band. Phone pushes the agreed percent to the ring (or both phones fetch the same deterministic pair score).
- **Stage 4+:** Crossed Paths / social graph; AI facilitator already lives at `POST /v1/facilitate` on `@nearby/api`.
