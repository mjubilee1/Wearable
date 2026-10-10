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

// Manufacturer advert: FF FF | 'N' 'B' | id[4]
static const uint16_t NEARBY_COMPANY_ID = 0xFFFF;
static const uint8_t NEARBY_MAGIC[2] = {'N', 'B'};
static const char NEARBY_NAME_PREFIX[] = "NB-";

// GATT — must match packages/shared CLIP LED UUIDs
// 4e420001-0000-1000-8000-00805f9b34fb
// 4e420002-0000-1000-8000-00805f9b34fb
static const char NEARBY_LED_SERVICE_UUID[] =
    "4E420001-0000-1000-8000-00805F9B34FB";
static const char NEARBY_LED_COLOR_CHAR_UUID[] =
    "4E420002-0000-1000-8000-00805F9B34FB";

static const uint8_t CLIP_LED_OFF = 0;
static const uint8_t CLIP_LED_GREEN = 1;

// No fresh phone write → ring off (phone stopped / out of range).
static const uint32_t LED_COMMAND_STALE_MS = 3000;

static const uint16_t ADV_INTERVAL_FAST = 32;
static const uint16_t ADV_INTERVAL_SLOW = 244;
