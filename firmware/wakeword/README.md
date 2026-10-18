# Hello Nearby wake word (XIAO nRF52840 Sense)

This is a separate voice experiment for the **Seeed XIAO nRF52840 Sense**.
It does not change the phone app or the older color-ring firmware.

## Current repository flow vs. this project

Before this folder, the XIAO projects used Bluefruit for BLE advertising, scanning, or a small writable LED characteristic. Their onboard microphone was unused. This folder is the voice firmware for the board on the desk.

This project adds the missing device-side path:

```text
PDM mic (16 kHz PCM16)
  -> local inference only while idle
  -> "hello nearby" >= threshold OR D0 button
  -> round display shows Listening, Holding, or Sending
  -> 80 ms onboard LED cue (optional haptic GPIO)
  -> BLE PCM notifications when the phone is connected
  -> otherwise one clip on the onboard flash, sent when the phone returns
  -> stop after 1.2 s silence or 10 s maximum
```

Idle audio is consumed by the local classifier and is **never written to a
BLE characteristic or to flash**. The placeholder model always returns zero, so only the
button opens the stream until a real model is installed.

If the phone is out of Bluetooth range, that one turn is written to the onboard
2 MB flash. A newer turn replaces it. When the phone connects and subscribes,
the board sends the held clip and erases it. This is not a recording of the day.

## Build and flash

PlatformIO is required:

```bash
cd firmware/wakeword
pio run -e xiaoblesense
pio run -e xiaoblesense -t upload
pio device monitor -e xiaoblesense -b 115200
```

This is the image that runs the microphone and the round display together.
`firmware/round-display` is the waveform bench only. Flashing it replaces this
image.

## Wiring

Confirm the board enumerates as USB `2886:8045` before flashing. One setup
covers both jobs. The display chip select is D1, so the backup button is D0.

```text
GC9A01 1.28"                         XIAO nRF52840 Sense
GND  ------------------------------ GND
VCC  ------------------------------ 3V3
SCK / SCL ------------------------- D8
MOSI / SDA ------------------------ D10
CS   ------------------------------ D1
DC   ------------------------------ D2
RST  ------------------------------ D3
BL, if the module has one -------- 3V3

Backup button, normally open
  one side ---------------------- D0
  other side -------------------- GND

Leave D9 open. The panel has no MISO.
```

```text
idle clock -- "hello nearby" or D0 --> listening -- silence or 10 s --> thinking
                                 |                                      |
                                 +-- phone away --> notice               +-- reply for 6 s --> idle
```

The glass is a round pendant face, not a watch. Idle shows the time and the
date in cream and warm gray. A line appears only when something needs the
wearer: no phone, low battery, or charge the battery. Listening and thinking
are a short word and three dots. A reply is wrapped text for 6 seconds.
`showNotice("Calendar", "Meeting in 10 min")` holds a title and a line for
8 seconds.

After 20 idle seconds the panel sleeps. The button wakes the clock; press it
again to start a turn. "Hello Nearby" or a phone connection also wakes it.
The backlight is tied to 3V3, so sleep turns the controller off, not that LED.

Under 15% the face says Low battery. Under 5% the screen and the radio turn
off. The RTC keeps the time. Press the button to glance at the clock. The
radio returns once the cell is back to 8%. A USB bench with no cell does not
take this path.

The onboard LED is the default cue. For a haptic motor, use a transistor and
flyback protection on a free pin such as D4 or D6. Do not power a motor from
a GPIO, and do not use D0–D3 or D8–D10. Set the pin with
`-DNEARBY_HAPTIC_PIN=<pin>`.

## Collect training audio

Record on this board’s microphone. Each take is three seconds, mono 16-bit
PCM at 16 kHz, so a slow "hello nearby" fits. Gather
many speakers, distances, rooms, and necklace positions. Avoid slicing one
long recording into both training and test sets.

Stop the serial monitor first so the script can open the USB port. The onboard
LED turns on for the window; say the phrase while it is lit. The board prints
that one window over USB and does not write it to flash or Bluetooth.

```bash
cd firmware/wakeword
python3 tools/record_clip.py --label hello_nearby
python3 tools/record_clip.py --label noise
python3 tools/record_clip.py --label unknown
```

Files land in `dataset/<label>/`, which is gitignored. When you upload, name
the Edge Impulse label for `hello_nearby` exactly `hello nearby`.

Suggested first dataset:

| Label | What to record |
|---|---|
| `hello nearby` | 3 second clips of the exact phrase; varied voices, pace, distance, and volume |
| `noise` | HVAC, traffic, café, music, handling/rubbing, keyboard, and silence |
| `unknown` | Other speech, especially “hello”, “nearby”, and similar phrases in sentences |

Aim for balanced duration across labels and keep recordings from some speakers
and rooms entirely in the test set. Include hard negatives from real wearing
conditions; they matter more than a high training accuracy.

## Train and export with Edge Impulse

1. Create an Edge Impulse audio project named `nearby_wakeword` and upload the
   labeled WAV clips. That name makes the generated public header
   `nearby_wakeword_inferencing.h`, which the adapter detects automatically.
2. Use a 16 kHz audio impulse with a 2 second window and an MFE or MFCC
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

The board advertises as `Nearby` plus four hex characters from its Bluetooth address, for example `Nearby AB12`. Serial prints `[ble] advertising as Nearby AB12` on boot.

Service: `4e421000-0000-1000-8000-00805f9b34fb`

| Characteristic | UUID suffix | Direction and payload |
|---|---|---|
| Audio | `1001` | Notify: little-endian PCM16, mono, 16 kHz |
| Wake settings | `1002` | Read/write two bytes: `[enabled, threshold_percent]`; default `[1, 85]` |
| Trigger event | `1003` | Notify two bytes: `[source, confidence_percent]`; source 1=word, 2=button |
| Reply | `1004` | Write UTF-8 text, at most 96 bytes. The round face shows it, then returns to the clock. |

Clock service: `4e421010-0000-1000-8000-00805f9b34fb`

| Characteristic | UUID | Direction and payload |
|---|---|---|
| Time | `4e421011-0000-1000-8000-00805f9b34fb` | Write 8 bytes, little-endian: `int32` Unix UTC seconds, then `int32` timezone offset in seconds. Local time is the sum. |

The standard Current Time Service `0x1805` is also writable (`0x2A2B` current time, `0x2A0F` local time). The phone app uses the custom characteristic. iOS does not push `0x1805` by itself.

Time is counted on RTC2 (the 32.768 kHz crystal), so it keeps moving while the CPU sleeps. Every few minutes, and again under 5%, that time is written to internal flash (`/time.bin`). A reboot shows the saved time in gray until the phone writes a fresh one. Before the first sync ever, the face shows `--:--` and `Open the Nearby app`.

The clock service is in the GATT table after connect. It is not in the advertising packet, because two 128-bit UUIDs do not fit. Write it on every connect.

Swift (call this from `didConnect`):

```swift
let nearbyTimeService = CBUUID(string: "4E421010-0000-1000-8000-00805F9B34FB")
let nearbyTimeChar = CBUUID(string: "4E421011-0000-1000-8000-00805F9B34FB")

func writeNearbyTime(_ peripheral: CBPeripheral, _ characteristic: CBCharacteristic) {
    var unix = Int32(Date().timeIntervalSince1970).littleEndian
    var offset = Int32(TimeZone.current.secondsFromGMT()).littleEndian
    var payload = Data()
    withUnsafeBytes(of: unix) { payload.append(contentsOf: $0) }
    withUnsafeBytes(of: offset) { payload.append(contentsOf: $0) }
    peripheral.writeValue(payload, for: characteristic, type: .withResponse)
}
```

React Native (`react-native-ble-plx` takes base64). The Expo app does this in `listen()` after discover:

```javascript
const TIME_SERVICE = "4e421010-0000-1000-8000-00805f9b34fb";
const TIME_CHAR = "4e421011-0000-1000-8000-00805f9b34fb";

export async function writeNearbyTime(device) {
  const unix = Math.floor(Date.now() / 1000);
  const offset = -new Date().getTimezoneOffset() * 60;
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, unix, true);
  view.setInt32(4, offset, true);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  await device.writeCharacteristicWithResponseForService(
    TIME_SERVICE,
    TIME_CHAR,
    btoa(binary)
  );
}
```

Confirm USB `2886:8045`, then flash this image (not `firmware/display_gc9a01` or `firmware/round-display`):

```bash
cd firmware/wakeword
pio run -e xiaoblesense -t upload
pio device monitor -e xiaoblesense -b 115200
```

The firmware requests MTU 247 and sizes packets to the negotiated MTU. A phone
receiver should subscribe to audio before triggering and concatenate
notifications in order. The phone app subscribes, wraps the PCM as a WAV, and sends it to `POST /v1/agent/speech`.

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
