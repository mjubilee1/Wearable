#pragma once

// --- Wiring (WS2812 / NeoPixel ring) -----------------------------------------
// DIN  -> XIAO D0  (P0.02)     override with -DNEARBY_NEOPIXEL_PIN=N
// VCC  -> XIAO 5V  (USB-powered; WS2812 prefers 5V)
// GND  -> XIAO GND
//
// 3.3V data into a 5V-powered ring usually works at short wire lengths.
// If the ring flickers or only the first LED lights, add a level shifter
// or a ~300–500Ω series resistor on DIN and a 100–1000µF cap across VCC/GND.

#ifndef NEARBY_NEOPIXEL_PIN
#define NEARBY_NEOPIXEL_PIN 0
#endif

#ifndef NEARBY_LED_COUNT
#define NEARBY_LED_COUNT 16
#endif

// Keep brightness low on USB / LiPo — rings draw hard at full white.
#ifndef NEARBY_LED_BRIGHTNESS
#define NEARBY_LED_BRIGHTNESS 40
#endif

// --- BLE identity ------------------------------------------------------------
// Manufacturer-specific advertising payload (company ID 0xFFFF = test/dev):
//   [0xFF, 0xFF, 'N', 'B', id0, id1, id2, id3]
static const uint16_t NEARBY_COMPANY_ID = 0xFFFF;
static const uint8_t NEARBY_MAGIC[2] = {'N', 'B'};

// Local name prefix visible to phones later (Stage 2): "NB-A1B2"
static const char NEARBY_NAME_PREFIX[] = "NB-";

// --- Fake local score (Stage 1 only) -----------------------------------------
// Closer RSSI → higher score. Tuned for indoor ~1–10 m walk-bys.
static const int8_t RSSI_FAR_DBM = -85;   // score ~0
static const int8_t RSSI_NEAR_DBM = -45;  // score ~100
static const uint32_t PEER_STALE_MS = 1200;
static const float SCORE_EMA_ALPHA = 0.25f;

// SoftDevice scan/adv intervals (units of 0.625 ms)
static const uint16_t ADV_INTERVAL_FAST = 32;   // 20 ms
static const uint16_t ADV_INTERVAL_SLOW = 244;  // 152.5 ms
static const uint16_t SCAN_INTERVAL = 160;      // 100 ms
static const uint16_t SCAN_WINDOW = 80;         // 50 ms
