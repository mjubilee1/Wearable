# Round display sketch

Seeed XIAO nRF52840 Sense driving a Teyleten GC9A01 1.28" 240x240 round display.

Sketch: `display_gc9a01.ino` in this folder.

This clock demo is separate from the desk image. Flash `firmware/wakeword` when the microphone and the panel should run together. The wiring diagram is in `firmware/wakeword/README.md`. Uploading this sketch replaces that image. D1 is display chip select in both. The wake-word button is D0.

The sketch does not use the microphone. Later, call `onWakeWord()` from `loop()` when "hello nearby" scores, and `showReply()` when the phone sends the spoken answer.

## Install

1. Arduino IDE → Boards Manager → install **Seeed nRF52 mbed-enabled Boards** by Seeed Studio, version **2.9.2 or newer**. Older versions read the battery pin wrong.
2. Tools → Board → **Seeed XIAO nRF52840 Sense**.
3. Library Manager → install:
   - **Adafruit GC9A01A** by Adafruit
   - **Adafruit GFX Library** by Adafruit
   - **Adafruit BusIO** by Adafruit (usually installed with GC9A01A; add it if the compiler says BusIO is missing)
4. File → Open → `firmware/display_gc9a01/display_gc9a01.ino`
5. Plug in the XIAO over USB. Tools → Port → the XIAO port. Upload.

Serial Monitor: **115200** baud. It prints `state: idle`, `state: listening`, `state: reply`, and the battery voltage.

## Wiring

The module labels say SCL and SDA. This display is SPI, not I2C.

| Display pin | XIAO pin | What it is |
|---|---|---|
| SCL | D8 | SPI clock (SCK) |
| SDA | D10 | SPI data (MOSI) |
| CS | D1 | Chip select |
| DC | D2 | Data / command |
| RST | D3 | Reset |
| VCC | 3V3 | Power |
| GND | GND | Ground |
| BL | 3V3 | Backlight, always on |

Battery: 3.7 V 250 mAh LiPo on the two BAT pads on the back of the XIAO. USB charges it. Do not connect the cell to a GPIO.

The sketch enables the onboard battery divider (P0.14, named `PIN_VBAT_ENABLE` in this board package) and leaves it on. Do not drive that pin high; pin 14 on this package is the blue LED, not the divider.

## What you should see

1. A large 12-hour clock on black, plus a battery icon and percent near the bottom. The clock starts from the time the sketch was compiled, then advances with `millis()`. It resets on every reboot.
2. About 20 seconds later, a purple and white waveform (listening).
3. Then the text `Hello Montrell, I'm listening.` for 6 seconds.
4. Back to the clock. The cycle repeats. Battery percent refreshes every 30 seconds.

With no LiPo attached, the percent can read 0. That is expected.

## Knobs in the sketch

Near the top of `display_gc9a01.ino`:

- `BENCH_TEST` — leave `true` until your own code calls `onWakeWord()` and `showReply()`. Then set it to `false`.
- `DISPLAY_ROTATION` — change `0` to `2` if the picture is upside down.
- `DISPLAY_INVERT` — set `true` if black and white are swapped.
- `SPI_HZ` — `16000000` is for jumper wires. `32000000` is fine on a short cable if the picture stays clean.

## If the screen stays blank

- BL and VCC are both on 3V3, GND is on GND.
- SCL is on D8 and SDA is on D10, not the I2C pins.
- Board is **Seeed XIAO nRF52840 Sense** under the mbed-enabled package, not the non-mbed "Seeed nRF52 Boards" package.
- Try `DISPLAY_ROTATION` 2, then `DISPLAY_INVERT` true.
