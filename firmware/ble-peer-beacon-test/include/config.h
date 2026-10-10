#pragma once

// Same payload as Stage 1 / green test: FF FF | 'N' 'B' | id[4]
static const uint16_t NEARBY_COMPANY_ID = 0xFFFF;
static const uint8_t NEARBY_MAGIC[2] = {'N', 'B'};
static const char NEARBY_NAME_PREFIX[] = "NB-";

static const uint16_t ADV_INTERVAL_FAST = 32;
static const uint16_t ADV_INTERVAL_SLOW = 244;
