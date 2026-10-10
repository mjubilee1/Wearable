#pragma once

// Ring: DIN -> D6, 5V -> 5V, GND -> GND

#ifndef NEARBY_NEOPIXEL_PIN
#define NEARBY_NEOPIXEL_PIN 6
#endif

#ifndef NEARBY_LED_COUNT
#define NEARBY_LED_COUNT 16
#endif

#ifndef NEARBY_LED_BRIGHTNESS
#define NEARBY_LED_BRIGHTNESS 40
#endif

// Same manufacturer payload as Stage 1: FF FF | 'N' 'B' | id[4]
static const uint16_t NEARBY_COMPANY_ID = 0xFFFF;
static const uint8_t NEARBY_MAGIC[2] = {'N', 'B'};
static const char NEARBY_NAME_PREFIX[] = "NB-";

// Peer counts as "in range" above this RSSI; gone after this silence.
static const int8_t RSSI_IN_RANGE_DBM = -80;
static const uint32_t PEER_STALE_MS = 1500;

static const uint16_t ADV_INTERVAL_FAST = 32;
static const uint16_t ADV_INTERVAL_SLOW = 244;
static const uint16_t SCAN_INTERVAL = 160;
static const uint16_t SCAN_WINDOW = 80;
