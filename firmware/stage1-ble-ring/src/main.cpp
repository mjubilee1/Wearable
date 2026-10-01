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
// Local device identity (unique per chip)
// -----------------------------------------------------------------------------

static uint8_t localDeviceId[4];
static char bleDeviceName[12];  // e.g. "NB-A1B2\0"

static void initLocalDeviceId() {
  // FICR DEVICEID is unique per chip and stable across resets.
  const uint32_t hardwareId = NRF_FICR->DEVICEID[0];
  localDeviceId[0] = (uint8_t)(hardwareId >> 24);
  localDeviceId[1] = (uint8_t)(hardwareId >> 16);
  localDeviceId[2] = (uint8_t)(hardwareId >> 8);
  localDeviceId[3] = (uint8_t)(hardwareId);

  snprintf(bleDeviceName, sizeof(bleDeviceName), "%s%02X%02X", NEARBY_NAME_PREFIX,
           localDeviceId[2], localDeviceId[3]);
}

static bool isOwnDeviceId(const uint8_t candidateId[4]) {
  return memcmp(candidateId, localDeviceId, 4) == 0;
}

// -----------------------------------------------------------------------------
// Peer proximity (RSSI → smoothed fake score)
// -----------------------------------------------------------------------------

struct PeerProximity {
  bool isVisible;
  int8_t lastRssiDbm;
  uint32_t lastSeenAtMs;
  float smoothedScore;  // 0–100
};

static PeerProximity peer = {};

static float rssiToProximityScore(int8_t rssiDbm) {
  if (rssiDbm <= RSSI_FAR_DBM) return 0.0f;
  if (rssiDbm >= RSSI_NEAR_DBM) return 100.0f;

  const float normalized =
      (float)(rssiDbm - RSSI_FAR_DBM) / (float)(RSSI_NEAR_DBM - RSSI_FAR_DBM);
  return normalized * 100.0f;
}

static void recordPeerSighting(int8_t rssiDbm) {
  const float instantScore = rssiToProximityScore(rssiDbm);

  if (!peer.isVisible) {
    peer.smoothedScore = instantScore;
  } else {
    peer.smoothedScore = SCORE_EMA_ALPHA * instantScore +
                         (1.0f - SCORE_EMA_ALPHA) * peer.smoothedScore;
  }

  peer.isVisible = true;
  peer.lastRssiDbm = rssiDbm;
  peer.lastSeenAtMs = millis();
}

static void fadePeerIfTimedOut() {
  if (!peer.isVisible) return;
  if ((millis() - peer.lastSeenAtMs) < PEER_STALE_MS) return;

  peer.isVisible = false;
  peer.lastRssiDbm = 0;
  // Soft fade so one missed advert packet doesn't hard-cut the ring.
  peer.smoothedScore *= 0.85f;
  if (peer.smoothedScore < 2.0f) peer.smoothedScore = 0.0f;
}

// -----------------------------------------------------------------------------
// LED ring — walk-by progress bar
// -----------------------------------------------------------------------------

static Adafruit_NeoPixel ledRing(NEARBY_LED_COUNT, NEARBY_NEOPIXEL_PIN,
                                 NEO_GRB + NEO_KHZ800);

static uint32_t colorForProximityScore(float score) {
  // red (far / 0) → orange (~45) → green (near / 100)
  uint8_t red;
  uint8_t green;
  const uint8_t blue = 0;

  if (score <= 45.0f) {
    const float blendTowardOrange = score / 45.0f;
    red = 255;
    green = (uint8_t)(blendTowardOrange * 140.0f);
  } else {
    const float blendTowardGreen = (score - 45.0f) / 55.0f;
    red = (uint8_t)(255.0f * (1.0f - blendTowardGreen));
    green = (uint8_t)(140.0f + blendTowardGreen * 115.0f);
  }

  return ledRing.Color(red, green, blue);
}

static void renderWalkByRing(float proximityScore) {
  const uint32_t fillColor = colorForProximityScore(proximityScore);
  const float litLedCount =
      (proximityScore / 100.0f) * (float)NEARBY_LED_COUNT;

  for (int ledIndex = 0; ledIndex < NEARBY_LED_COUNT; ledIndex++) {
    if ((float)(ledIndex + 1) <= litLedCount) {
      ledRing.setPixelColor(ledIndex, fillColor);
    } else if ((float)ledIndex < litLedCount) {
      // Dim the edge LED for smoother progress between whole steps.
      const float partialBrightness = litLedCount - (float)ledIndex;
      const uint8_t red =
          (uint8_t)(((fillColor >> 16) & 0xFF) * partialBrightness);
      const uint8_t green =
          (uint8_t)(((fillColor >> 8) & 0xFF) * partialBrightness);
      const uint8_t blue = (uint8_t)((fillColor & 0xFF) * partialBrightness);
      ledRing.setPixelColor(ledIndex, ledRing.Color(red, green, blue));
    } else {
      ledRing.setPixelColor(ledIndex, 0);
    }
  }

  // Idle heartbeat on LED 0 when alone so you know the board is alive.
  if (proximityScore < 1.0f) {
    const float breathWave =
        0.5f + 0.5f * sinf((float)millis() / 500.0f);  // slow pulse
    const uint8_t breathBlue = (uint8_t)(8.0f + breathWave * 18.0f);
    ledRing.setPixelColor(0, ledRing.Color(0, 0, breathBlue));
  }

  ledRing.show();
}

// -----------------------------------------------------------------------------
// BLE advertise + scan (no connection)
// -----------------------------------------------------------------------------

static uint8_t manufacturerPayload[8];

static void buildManufacturerPayload() {
  manufacturerPayload[0] = (uint8_t)(NEARBY_COMPANY_ID & 0xFF);
  manufacturerPayload[1] = (uint8_t)(NEARBY_COMPANY_ID >> 8);
  manufacturerPayload[2] = NEARBY_MAGIC[0];
  manufacturerPayload[3] = NEARBY_MAGIC[1];
  memcpy(&manufacturerPayload[4], localDeviceId, 4);
}

static bool tryParseNearbyManufacturerData(const uint8_t *buffer, uint8_t length,
                                           uint8_t outPeerId[4]) {
  // SoftDevice reports company ID already included in manufacturer payload.
  if (length < 8) return false;
  if (buffer[0] != (uint8_t)(NEARBY_COMPANY_ID & 0xFF)) return false;
  if (buffer[1] != (uint8_t)(NEARBY_COMPANY_ID >> 8)) return false;
  if (buffer[2] != NEARBY_MAGIC[0] || buffer[3] != NEARBY_MAGIC[1]) return false;
  memcpy(outPeerId, &buffer[4], 4);
  return true;
}

static void onScanAdvertisement(ble_gap_evt_adv_report_t *report) {
  uint8_t manufacturerBuffer[32];
  const uint8_t payloadLength = Bluefruit.Scanner.parseReportByType(
      report, BLE_GAP_AD_TYPE_MANUFACTURER_SPECIFIC_DATA, manufacturerBuffer,
      sizeof(manufacturerBuffer));

  uint8_t peerDeviceId[4];
  if (!tryParseNearbyManufacturerData(manufacturerBuffer, payloadLength,
                                      peerDeviceId)) {
    Bluefruit.Scanner.resume();
    return;
  }
  if (isOwnDeviceId(peerDeviceId)) {
    Bluefruit.Scanner.resume();
    return;
  }

  recordPeerSighting(report->rssi);
  Bluefruit.Scanner.resume();
}

static void startAdvertising() {
  Bluefruit.Advertising.clearData();
  Bluefruit.ScanResponse.clearData();

  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addManufacturerData(manufacturerPayload,
                                            sizeof(manufacturerPayload));

  // Readable name fits better in the scan response than the adv packet.
  Bluefruit.ScanResponse.addName();

  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(ADV_INTERVAL_FAST, ADV_INTERVAL_SLOW);
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);  // advertise forever
}

static void startScanning() {
  Bluefruit.Scanner.setRxCallback(onScanAdvertisement);
  Bluefruit.Scanner.restartOnDisconnect(true);
  Bluefruit.Scanner.setInterval(SCAN_INTERVAL, SCAN_WINDOW);
  Bluefruit.Scanner.filterRssi(RSSI_FAR_DBM - 5);
  Bluefruit.Scanner.useActiveScan(true);  // request scan response (name)
  Bluefruit.Scanner.start(0);             // scan forever
}

static void setupBle() {
  // Peripheral (advertise) + Central (scan) roles at the same time.
  if (!Bluefruit.begin(1, 1)) {
    Serial.println("Bluefruit.begin failed");
    while (1) delay(100);
  }

  Bluefruit.setTxPower(4);  // max for many XIAO configs; ok for demo range
  Bluefruit.setName(bleDeviceName);

  buildManufacturerPayload();
  startAdvertising();
  startScanning();

  Serial.printf("Advertising as %s\n", bleDeviceName);
  Serial.printf("Device ID %02X%02X%02X%02X\n", localDeviceId[0], localDeviceId[1],
                localDeviceId[2], localDeviceId[3]);
}

// -----------------------------------------------------------------------------
// Arduino entry
// -----------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  // Don't block forever if USB serial isn't open.
  const uint32_t serialWaitStartedAtMs = millis();
  while (!Serial && (millis() - serialWaitStartedAtMs) < 2000) {
    delay(10);
  }

  initLocalDeviceId();

  ledRing.begin();
  ledRing.setBrightness(NEARBY_LED_BRIGHTNESS);
  ledRing.clear();
  ledRing.show();

  Serial.println();
  Serial.println("Nearby Stage 1 — BLE walk-by ring");
  Serial.printf("NeoPixel D%d x%d brightness %d\n", NEARBY_NEOPIXEL_PIN,
                NEARBY_LED_COUNT, NEARBY_LED_BRIGHTNESS);

  setupBle();
}

void loop() {
  fadePeerIfTimedOut();

  // Keep fading toward 0 after the peer leaves range.
  if (!peer.isVisible && peer.smoothedScore > 0.0f) {
    peer.smoothedScore *= 0.92f;
    if (peer.smoothedScore < 1.0f) peer.smoothedScore = 0.0f;
  }

  renderWalkByRing(peer.smoothedScore);

  static uint32_t lastLogAtMs = 0;
  if (millis() - lastLogAtMs > 500) {
    lastLogAtMs = millis();
    if (peer.isVisible || peer.smoothedScore > 0.0f) {
      Serial.printf("peer rssi=%d score=%.0f\n", peer.lastRssiDbm,
                    peer.smoothedScore);
    }
  }

  delay(20);
}
