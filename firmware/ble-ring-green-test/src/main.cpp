/**
 * BLE + ring desk test (one ring board)
 *
 * - Advertises Nearby manufacturer data (same as Stage 1).
 * - Scans for another Nearby board (ignores self).
 * - Ring solid GREEN while a peer was seen recently; OFF when alone.
 *
 * Flash this onto the board with the ring on D6.
 * Power a second XIAO that still runs Stage 1 (no ring required).
 */

#include <Arduino.h>
#include <Adafruit_TinyUSB.h>
#include <bluefruit.h>
#include <Adafruit_NeoPixel.h>

#include "config.h"

static uint8_t localDeviceId[4];
static char bleDeviceName[12];

static bool peerInRange = false;
static int8_t peerRssi = 0;
static uint32_t peerLastSeenAtMs = 0;

static Adafruit_NeoPixel ledRing(NEARBY_LED_COUNT, NEARBY_NEOPIXEL_PIN,
                                 NEO_GRB + NEO_KHZ800);

static uint8_t manufacturerPayload[8];

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

/** Prove the ring can show green before waiting on a BLE peer. */
static void runGreenSelfTest(uint32_t durationMs) {
  Serial.printf("Self-test: solid GREEN for %lu seconds…\n",
                (unsigned long)(durationMs / 1000));
  fillRingGreen();
  delay(durationMs);
  clearRing();
  Serial.println("Self-test done. Waiting for a Nearby peer…");
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
  if (report->rssi < RSSI_IN_RANGE_DBM) {
    Bluefruit.Scanner.resume();
    return;
  }

  peerInRange = true;
  peerRssi = report->rssi;
  peerLastSeenAtMs = millis();
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
  Bluefruit.Scanner.filterRssi(RSSI_IN_RANGE_DBM - 5);
  Bluefruit.Scanner.useActiveScan(true);
  Bluefruit.Scanner.start(0);
}

static void setupBle() {
  if (!Bluefruit.begin(1, 1)) {
    Serial.println("Bluefruit.begin failed");
    while (1) delay(100);
  }

  Bluefruit.setTxPower(4);
  Bluefruit.setName(bleDeviceName);
  buildManufacturerPayload();
  startAdvertising();
  startScanning();

  Serial.printf("Advertising as %s\n", bleDeviceName);
  Serial.printf("Device ID %02X%02X%02X%02X\n", localDeviceId[0], localDeviceId[1],
                localDeviceId[2], localDeviceId[3]);
  Serial.println("Ring GREEN when another Nearby board is heard; OFF alone.");
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
  Serial.println("BLE ring green test (D6)");
  // 15s green so you can confirm wiring without a second board.
  runGreenSelfTest(15000);
  setupBle();
}

void loop() {
  if (peerInRange && (millis() - peerLastSeenAtMs) > PEER_STALE_MS) {
    peerInRange = false;
    peerRssi = 0;
    Serial.println("peer lost — ring OFF");
  }

  renderRing();

  static uint32_t lastLogAtMs = 0;
  if (peerInRange && (millis() - lastLogAtMs) > 500) {
    lastLogAtMs = millis();
    Serial.printf("peer rssi=%d — ring GREEN\n", peerRssi);
  }

  delay(40);
}
