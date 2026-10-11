#pragma once

// BLE audio is intentionally off. The chip in hand has no BLE radio.
// When the ESP32-S3 arrives, flip NEARBY_HAS_BLE in platformio.ini and
// implement the GATT notify path here. Do not put model keys on the board.

void ble_audio_setup();
