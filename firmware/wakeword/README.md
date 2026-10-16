# Hello Nearby wake word (XIAO nRF52840 Sense)

This is a separate voice experiment for the **Seeed XIAO nRF52840 Sense**.
It does not change the phone app or the older color-ring firmware.

## Current repository flow vs. this project

Before this folder, the XIAO projects used Bluefruit for BLE advertising, scanning, or a small writable LED characteristic. Their onboard microphone was unused. This folder is the voice firmware for the board on the desk.

This project adds the missing device-side path:

```text
PDM mic (16 kHz PCM16)
  -> local inference only while idle
  -> "hello nearby" >= threshold OR D1 button
  -> 80 ms onboard LED cue (optional haptic GPIO)
  -> BLE PCM notifications
  -> stop after 1.2 s silence or 10 s maximum
```

Idle audio is consumed by the local classifier and is **never written to a
BLE characteristic**. The placeholder model always returns zero, so only the
button opens the stream until a real model is installed.

## Build and flash

PlatformIO is required:

```bash
cd firmware/wakeword
pio run -e xiaoblesense
pio run -e xiaoblesense -t upload
pio device monitor -e xiaoblesense -b 115200
```

Wire a normally-open backup button from **D1 to GND**. The onboard LED is the
default cue. For a haptic motor, use a transistor/driver and flyback protection;
do not power a motor from a GPIO. Set its control pin with
`-DNEARBY_HAPTIC_PIN=<pin>`.

## Collect training audio

Record on the target board/microphone when possible. Use mono, 16-bit WAV at
16 kHz and gather many speakers, distances, rooms, and necklace positions.
Avoid slicing one long recording into both training and test sets.

Suggested first dataset:

| Label | What to record |
|---|---|
| `hello nearby` | 1–2 second clips of the exact phrase; varied voices, pace, distance, and volume |
| `noise` | HVAC, traffic, café, music, handling/rubbing, keyboard, and silence |
| `unknown` | Other speech, especially “hello”, “nearby”, and similar phrases in sentences |

Aim for balanced duration across labels and keep recordings from some speakers
and rooms entirely in the test set. Include hard negatives from real wearing
conditions; they matter more than a high training accuracy.

## Train and export with Edge Impulse

1. Create an Edge Impulse audio project named `nearby_wakeword` and upload the
   labeled WAV clips. That name makes the generated public header
   `nearby_wakeword_inferencing.h`, which the adapter detects automatically.
2. Use a 16 kHz audio impulse, typically a 1 second window with an MFE or MFCC
   processing block and a small classification network.
3. Train three labels named exactly `hello nearby`, `noise`, and `unknown`.
4. Check the confusion matrix, then run **Model testing** on held-out speakers.
5. In **Deployment**, select **Arduino library**, enable the EON compiler and
   int8 quantization when they fit/perform well, then build the ZIP.
6. Unzip the export under:

   ```text
   firmware/wakeword/lib/nearby_wakeword_inferencing/
   ```

   The folder must expose `nearby_wakeword_inferencing.h`. Rebuild; serial
   should say `Edge Impulse ready` instead of `PLACEHOLDER active`.

`src/wakeword_model.cpp` is the small adapter. The checked-in placeholder
contains no trained weights and intentionally cannot detect a wake word.

## BLE contract

Service: `4e421000-0000-1000-8000-00805f9b34fb`

| Characteristic | UUID suffix | Direction and payload |
|---|---|---|
| Audio | `1001` | Notify: little-endian PCM16, mono, 16 kHz |
| Wake settings | `1002` | Read/write two bytes: `[enabled, threshold_percent]`; default `[1, 85]` |
| Trigger event | `1003` | Notify two bytes: `[source, confidence_percent]`; source 1=word, 2=button |

The firmware requests MTU 247 and sizes packets to the negotiated MTU. A phone
receiver should subscribe to audio before triggering and concatenate
notifications in order. This PR deliberately does not change the app.

## Tuning

- Change the default with `-DNEARBY_WAKE_THRESHOLD=0.85f`, or write the
  settings characteristic at runtime.
- Type `s` in the serial monitor for detection, manually marked false-trigger,
  dropped-sample, and model status counters.
- Immediately type `f` after an unwanted wake to increment the false-trigger
  count. Firmware cannot know user intent, so false triggers need this manual
  ground truth.
- Adjust `NEARBY_SILENCE_RMS` only after logging real mic levels. Too high cuts
  off quiet speech; too low runs every capture to 10 seconds.

## Expected battery impact and measurement

“Low power” here means **local wake-only processing instead of continuous BLE
audio**. The PDM microphone, 64 MHz CPU inference, and RAM stay active, so this
is not the nRF52840's microamp system-off state. A sensible planning range is:

- wake listening: roughly **5–15 mA**, strongly dependent on model size,
  inference cadence, core/library, and microphone;
- active inference plus BLE audio: roughly **8–20 mA**, with connection
  interval, MTU, retries, LED/haptic, and RF conditions causing large swings.

These are engineering estimates, not measured claims. For a 100 mAh battery,
10 mA average would be about 10 hours in the ideal calculation, then less after
regulator loss and usable-capacity limits.

Measure the real hardware:

1. Power the battery input through a Nordic Power Profiler Kit II, Joulescope,
   or similar current logger. Do not include USB/serial current.
2. Remove/disable external ring LEDs and set `NEARBY_HAPTIC_PIN=-1`.
3. Record at least 10 minutes in each state: wake disabled, wake listening,
   connected idle, and repeated BLE captures.
4. Export average current and charge (`mAh`) per state. Weight those values by
   expected daily time in each state:

   `daily mAh = sum(state current mA * state hours)`

5. Repeat with the final model and enclosure; model duty cycle, acoustic
   retries, RF loss, and haptic load can change the result materially.
