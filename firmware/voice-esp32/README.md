# Nearby voice firmware (Wi-Fi)

Serial stand-in for the microphone. The board joins Wi-Fi and posts each typed line to `POST /v1/agent`. The reply prints on the serial monitor. If the agent asks permission, type `yes` or `no`.

The chip on the desk has no BLE radio. `NEARBY_HAS_BLE` is `0` in every env, including the ESP32-S3 env, so tomorrow's board can be flashed without turning the radio on. Audio over BLE belongs in `src/ble_audio.cpp` after that board arrives.

This tree does not hold model keys. `DEVICE_TOKEN` is a Firebase ID token, or the word `dev` when the API is running without Firebase Admin credentials.

The color-ring projects under the other `firmware/` folders stay as they are. Do not extend them.

## Flash

```sh
cd firmware/voice-esp32
cp include/secrets.h.example include/secrets.h
# edit Wi-Fi, API_BASE (your computer's LAN address), and DEVICE_TOKEN

pio run -e qtpy-s2 -t upload
pio device monitor -e qtpy-s2
```

| Env | Board |
|---|---|
| `qtpy-s2` | Adafruit QT Py ESP32-S2 (Wi-Fi, no BLE). Default. |
| `qtpy-s3` | Adafruit QT Py ESP32-S3. Radio present, left off. |
| `esp32dev` | Generic ESP32 dev board. BLE left off. |

If the silkscreen does not match those boards, change `board` in `platformio.ini` before uploading. Double-tap reset if the upload port does not appear.
