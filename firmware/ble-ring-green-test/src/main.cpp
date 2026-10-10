/**
 * BLE + ring desk test (one ring board)
 *
 * - Advertises Nearby manufacturer data (same as Stage 1).
 * - Scans for another Nearby board (ignores self).
 * - Ring solid GREEN while a peer was seen recently; OFF when alone.
 *
 * Flash onto boards with the ring on D6. Watch Serial at 115200 for logs.
 */

#include <Arduino.h>
#include <Adafruit_TinyUSB.h>
#include <bluefruit.h>
#include <Adafruit_NeoPixel.h>

#include "config.h"

static uint8_t localDeviceId[4];
static char bleDeviceName[12];

// In-range peer (drives the ring)
static bool peerInRange = false;
static int8_t peerRssi = 0;
static uint32_t peerLastSeenAtMs = 0;
static uint8_t peerId[4] = {};

// Last Nearby advert heard (even if too far for green)
static bool heardNearby = false;
static int8_t lastHeardRssi = 0;
static uint32_t lastHeardAtMs = 0;
static uint8_t lastHeardId[4] = {};
static uint32_t nearbyPacketCount = 0;

static Adafruit_NeoPixel ledRing(NEARBY_LED_COUNT, NEARBY_NEOPIXEL_PIN,
                                 NEO_GRB + NEO_KHZ800);

static uint8_t manufacturerPayload[8];

static void logPeerId(const char *label, const uint8_t id[4]) {
  Serial.printf("%s %02X%02X%02X%02X", label, id[0], id[1], id[2], id[3]);
}

static void initLocalDeviceId() {
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

static void fillRingGreen() {
  const uint32_t green = ledRing.Color(0, 255, 0);
  for (int i = 0; i < NEARBY_LED_COUNT; i++) {
    ledRing.setPixelColor(i, green);
  }
  ledRing.show();
}

static void clearRing() {
  ledRing.clear();
  ledRing.show();
}

static void renderRing() {
  if (peerInRange) {
    fillRingGreen();
  } else {
    clearRing();
  }
}

static void runGreenSelfTest(uint32_t durationMs) {
  Serial.printf("[self-test] solid GREEN for %lu s\n",
                (unsigned long)(durationMs / 1000));
  fillRingGreen();
  delay(durationMs);
  clearRing();
  Serial.println("[self-test] done — listening for Nearby peers");
}

static void buildManufacturerPayload() {
  manufacturerPayload[0] = (uint8_t)(NEARBY_COMPANY_ID & 0xFF);
  manufacturerPayload[1] = (uint8_t)(NEARBY_COMPANY_ID >> 8);
  manufacturerPayload[2] = NEARBY_MAGIC[0];
  manufacturerPayload[3] = NEARBY_MAGIC[1];
  memcpy(&manufacturerPayload[4], localDeviceId, 4);
}

static bool tryParseNearbyManufacturerData(const uint8_t *buffer, uint8_t length,
                                           uint8_t outPeerId[4]) {
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

  // Keep scan callback light — just store state; loop() prints.
  nearbyPacketCount++;
  heardNearby = true;
  lastHeardRssi = report->rssi;
  lastHeardAtMs = millis();
  memcpy(lastHeardId, peerDeviceId, 4);

  if (report->rssi >= RSSI_IN_RANGE_DBM) {
    peerInRange = true;
    peerRssi = report->rssi;
    peerLastSeenAtMs = millis();
    memcpy(peerId, peerDeviceId, 4);
  }

  Bluefruit.Scanner.resume();
}

static void startAdvertising() {
  Bluefruit.Advertising.clearData();
  Bluefruit.ScanResponse.clearData();
  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addManufacturerData(manufacturerPayload,
                                            sizeof(manufacturerPayload));
  Bluefruit.ScanResponse.addName();
  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(ADV_INTERVAL_FAST, ADV_INTERVAL_SLOW);
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);
}

static void startScanning() {
  Bluefruit.Scanner.setRxCallback(onScanAdvertisement);
  Bluefruit.Scanner.restartOnDisconnect(true);
  Bluefruit.Scanner.setInterval(SCAN_INTERVAL, SCAN_WINDOW);
  // Hear a bit weaker than the green threshold so we can log "too far".
  Bluefruit.Scanner.filterRssi(RSSI_IN_RANGE_DBM - 25);
  Bluefruit.Scanner.useActiveScan(true);
  Bluefruit.Scanner.start(0);
}

static void setupBle() {
  if (!Bluefruit.begin(1, 1)) {
    Serial.println("[ble] Bluefruit.begin FAILED");
    while (1) delay(100);
  }

  Bluefruit.setTxPower(4);
  Bluefruit.setName(bleDeviceName);
  buildManufacturerPayload();
  startAdvertising();
  startScanning();

  Serial.println("[ble] advertise + scan started");
  Serial.printf("[ble] local name %s\n", bleDeviceName);
  logPeerId("[ble] local id", localDeviceId);
  Serial.println();
  Serial.printf("[ble] green if RSSI >= %d dBm; stale after %lu ms\n",
                (int)RSSI_IN_RANGE_DBM, (unsigned long)PEER_STALE_MS);
  Serial.printf("[led] pin D%d  count %d  brightness %d\n", NEARBY_NEOPIXEL_PIN,
                NEARBY_LED_COUNT, NEARBY_LED_BRIGHTNESS);
}

void setup() {
  Serial.begin(115200);
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
  Serial.println("======== BLE ring green test ========");
  runGreenSelfTest(15000);
  setupBle();
  Serial.println("======== ready ========");
}

void loop() {
  static bool wasInRange = false;
  static uint32_t lastStatusLogAtMs = 0;
  static int8_t lastLoggedFarRssi = 0;

  // Peer timed out → ring off
  if (peerInRange && (millis() - peerLastSeenAtMs) > PEER_STALE_MS) {
    peerInRange = false;
    peerRssi = 0;
    Serial.print("[peer] LOST ");
    logPeerId("id", peerId);
    Serial.println(" — ring OFF");
  }

  // Entered range
  if (peerInRange && !wasInRange) {
    Serial.print("[peer] ENTER range ");
    logPeerId("id", peerId);
    Serial.printf(" rssi=%d — ring GREEN\n", (int)peerRssi);
  }
  wasInRange = peerInRange;

  renderRing();

  const uint32_t now = millis();
  if (now - lastStatusLogAtMs < 500) {
    delay(40);
    return;
  }
  lastStatusLogAtMs = now;

  if (peerInRange) {
    Serial.print("[peer] alive ");
    logPeerId("id", peerId);
    Serial.printf(" rssi=%d packets=%lu — GREEN\n", (int)peerRssi,
                  (unsigned long)nearbyPacketCount);
  } else if (heardNearby && (now - lastHeardAtMs) < 2000) {
    // Heard Nearby but not close enough for green (helps tune 2ft threshold)
    if (lastHeardRssi != lastLoggedFarRssi || (now - lastHeardAtMs) < 600) {
      Serial.print("[peer] heard but FAR ");
      logPeerId("id", lastHeardId);
      Serial.printf(" rssi=%d (need >= %d) — ring OFF\n", (int)lastHeardRssi,
                    (int)RSSI_IN_RANGE_DBM);
      lastLoggedFarRssi = lastHeardRssi;
    }
  } else if ((now / 2000) != ((now - 500) / 2000)) {
    // Occasional idle heartbeat so you know scan is alive
    Serial.printf("[idle] scanning… packets=%lu threshold=%d dBm\n",
                  (unsigned long)nearbyPacketCount, (int)RSSI_IN_RANGE_DBM);
  }

  delay(40);
}
