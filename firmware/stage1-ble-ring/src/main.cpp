/**
 * Nearby Stage 1 — BLE proximity walk-by on Seeed XIAO nRF52840
 *
 * Each board:
 *   1. Derives a stable 4-byte device ID from the Nordic FICR.
 *   2. Advertises manufacturer data: FF FF | 'N' 'B' | id[4]
 *   3. Scans for the same payload from a peer (no connect, no mic).
 *   4. Maps peer RSSI → fake local score 0–100.
 *   5. Fills a 16-LED WS2812 ring as a walk-by bar (red → orange → green).
 *
 * Flash the SAME firmware to both boards. IDs differ per chip automatically.
 */

#include <Arduino.h>
#include <Adafruit_TinyUSB.h>
#include <bluefruit.h>
#include <Adafruit_NeoPixel.h>

#include "config.h"

// -----------------------------------------------------------------------------
// Device identity
// -----------------------------------------------------------------------------

static uint8_t g_deviceId[4];
static char g_localName[12];  // "NB-A1B2\0"

static void initDeviceId() {
  // FICR DEVICEID is unique per chip; stable across resets.
  const uint32_t id = NRF_FICR->DEVICEID[0];
  g_deviceId[0] = (uint8_t)(id >> 24);
  g_deviceId[1] = (uint8_t)(id >> 16);
  g_deviceId[2] = (uint8_t)(id >> 8);
  g_deviceId[3] = (uint8_t)(id);

  snprintf(g_localName, sizeof(g_localName), "%s%02X%02X", NEARBY_NAME_PREFIX,
           g_deviceId[2], g_deviceId[3]);
}

static bool isSelfId(const uint8_t id[4]) {
  return memcmp(id, g_deviceId, 4) == 0;
}

// -----------------------------------------------------------------------------
// Peer / fake score
// -----------------------------------------------------------------------------

struct PeerState {
  bool seen;
  int8_t rssi;
  uint32_t lastSeenMs;
  float scoreEma;  // 0–100
};

static PeerState g_peer = {};

static float rssiToScore(int8_t rssi) {
  if (rssi <= RSSI_FAR_DBM) return 0.0f;
  if (rssi >= RSSI_NEAR_DBM) return 100.0f;
  const float t =
      (float)(rssi - RSSI_FAR_DBM) / (float)(RSSI_NEAR_DBM - RSSI_FAR_DBM);
  return t * 100.0f;
}

static void notePeerSighting(int8_t rssi) {
  const float instant = rssiToScore(rssi);
  if (!g_peer.seen) {
    g_peer.scoreEma = instant;
  } else {
    g_peer.scoreEma =
        SCORE_EMA_ALPHA * instant + (1.0f - SCORE_EMA_ALPHA) * g_peer.scoreEma;
  }
  g_peer.seen = true;
  g_peer.rssi = rssi;
  g_peer.lastSeenMs = millis();
}

static void decayPeerIfStale() {
  if (!g_peer.seen) return;
  if ((millis() - g_peer.lastSeenMs) < PEER_STALE_MS) return;

  g_peer.seen = false;
  g_peer.rssi = 0;
  // Soft fade-out so the bar doesn't hard-cut when one advert packet is missed.
  g_peer.scoreEma *= 0.85f;
  if (g_peer.scoreEma < 2.0f) g_peer.scoreEma = 0.0f;
}

// -----------------------------------------------------------------------------
// LEDs — walk-by progress bar
// -----------------------------------------------------------------------------

static Adafruit_NeoPixel g_ring(NEARBY_LED_COUNT, NEARBY_NEOPIXEL_PIN,
                                NEO_GRB + NEO_KHZ800);

static uint32_t scoreColor(float score) {
  // red (0) → orange (~45) → green (100)
  uint8_t r, g, b = 0;
  if (score <= 45.0f) {
    const float t = score / 45.0f;
    r = 255;
    g = (uint8_t)(t * 140.0f);
  } else {
    const float t = (score - 45.0f) / 55.0f;
    r = (uint8_t)(255.0f * (1.0f - t));
    g = (uint8_t)(140.0f + t * 115.0f);
  }
  return g_ring.Color(r, g, b);
}

static void renderWalkByBar(float score) {
  const uint32_t color = scoreColor(score);
  const float lit = (score / 100.0f) * (float)NEARBY_LED_COUNT;

  for (int i = 0; i < NEARBY_LED_COUNT; i++) {
    if ((float)(i + 1) <= lit) {
      g_ring.setPixelColor(i, color);
    } else if ((float)i < lit) {
      // Partial last LED for smoother progress.
      const float frac = lit - (float)i;
      const uint8_t r = (uint8_t)(((color >> 16) & 0xFF) * frac);
      const uint8_t g = (uint8_t)(((color >> 8) & 0xFF) * frac);
      const uint8_t b = (uint8_t)((color & 0xFF) * frac);
      g_ring.setPixelColor(i, g_ring.Color(r, g, b));
    } else {
      g_ring.setPixelColor(i, 0);
    }
  }

  // Idle heartbeat on LED 0 when alone so you know the board is alive.
  if (score < 1.0f) {
    const float breath =
        0.5f + 0.5f * sinf((float)millis() / 500.0f);  // ~slow pulse
    const uint8_t v = (uint8_t)(8.0f + breath * 18.0f);
    g_ring.setPixelColor(0, g_ring.Color(0, 0, v));
  }

  g_ring.show();
}

// -----------------------------------------------------------------------------
// BLE advertise + scan (no connection)
// -----------------------------------------------------------------------------

static uint8_t g_mfgPayload[8];

static void buildMfgPayload() {
  g_mfgPayload[0] = (uint8_t)(NEARBY_COMPANY_ID & 0xFF);
  g_mfgPayload[1] = (uint8_t)(NEARBY_COMPANY_ID >> 8);
  g_mfgPayload[2] = NEARBY_MAGIC[0];
  g_mfgPayload[3] = NEARBY_MAGIC[1];
  memcpy(&g_mfgPayload[4], g_deviceId, 4);
}

static bool parseNearbyMfg(const uint8_t *buf, uint8_t len, uint8_t outId[4]) {
  // SoftDevice reports company ID already included in manufacturer payload.
  if (len < 8) return false;
  if (buf[0] != (uint8_t)(NEARBY_COMPANY_ID & 0xFF)) return false;
  if (buf[1] != (uint8_t)(NEARBY_COMPANY_ID >> 8)) return false;
  if (buf[2] != NEARBY_MAGIC[0] || buf[3] != NEARBY_MAGIC[1]) return false;
  memcpy(outId, &buf[4], 4);
  return true;
}

static void scanCallback(ble_gap_evt_adv_report_t *report) {
  uint8_t buffer[32];
  const uint8_t len = Bluefruit.Scanner.parseReportByType(
      report, BLE_GAP_AD_TYPE_MANUFACTURER_SPECIFIC_DATA, buffer, sizeof(buffer));

  uint8_t peerId[4];
  if (!parseNearbyMfg(buffer, len, peerId)) {
    Bluefruit.Scanner.resume();
    return;
  }
  if (isSelfId(peerId)) {
    Bluefruit.Scanner.resume();
    return;
  }

  notePeerSighting(report->rssi);
  Bluefruit.Scanner.resume();
}

static void startAdvertising() {
  Bluefruit.Advertising.clearData();
  Bluefruit.ScanResponse.clearData();

  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addManufacturerData(g_mfgPayload, sizeof(g_mfgPayload));

  // Put the readable name in the scan response (fits better there).
  Bluefruit.ScanResponse.addName();

  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(ADV_INTERVAL_FAST, ADV_INTERVAL_SLOW);
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);  // advertise forever
}

static void startScanning() {
  Bluefruit.Scanner.setRxCallback(scanCallback);
  Bluefruit.Scanner.restartOnDisconnect(true);
  Bluefruit.Scanner.setInterval(SCAN_INTERVAL, SCAN_WINDOW);
  Bluefruit.Scanner.filterRssi(RSSI_FAR_DBM - 5);
  Bluefruit.Scanner.useActiveScan(true);  // request scan response (name)
  Bluefruit.Scanner.start(0);             // scan forever
}

static void setupBle() {
  // Peripheral (advertise) + Central (scan) roles concurrently.
  if (!Bluefruit.begin(1, 1)) {
    Serial.println("Bluefruit.begin failed");
    while (1) delay(100);
  }

  Bluefruit.setTxPower(4);  // max for many XIAO configs; ok for demo range
  Bluefruit.setName(g_localName);

  buildMfgPayload();
  startAdvertising();
  startScanning();

  Serial.printf("Advertising as %s\n", g_localName);
  Serial.printf("Device ID %02X%02X%02X%02X\n", g_deviceId[0], g_deviceId[1],
                g_deviceId[2], g_deviceId[3]);
}

// -----------------------------------------------------------------------------
// Arduino entry
// -----------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  // Don't block forever if USB serial isn't open.
  uint32_t t0 = millis();
  while (!Serial && (millis() - t0) < 2000) {
    delay(10);
  }

  initDeviceId();

  g_ring.begin();
  g_ring.setBrightness(NEARBY_LED_BRIGHTNESS);
  g_ring.clear();
  g_ring.show();

  Serial.println();
  Serial.println("Nearby Stage 1 — BLE walk-by ring");
  Serial.printf("NeoPixel D%d x%d brightness %d\n", NEARBY_NEOPIXEL_PIN,
                NEARBY_LED_COUNT, NEARBY_LED_BRIGHTNESS);

  setupBle();
}

void loop() {
  decayPeerIfStale();

  // Continue fading toward 0 when peer is gone.
  if (!g_peer.seen && g_peer.scoreEma > 0.0f) {
    g_peer.scoreEma *= 0.92f;
    if (g_peer.scoreEma < 1.0f) g_peer.scoreEma = 0.0f;
  }

  renderWalkByBar(g_peer.scoreEma);

  static uint32_t lastLog = 0;
  if (millis() - lastLog > 500) {
    lastLog = millis();
    if (g_peer.seen || g_peer.scoreEma > 0.0f) {
      Serial.printf("peer rssi=%d score=%.0f\n", g_peer.rssi, g_peer.scoreEma);
    }
  }

  delay(20);
}
