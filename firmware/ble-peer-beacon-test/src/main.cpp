/**
 * Peer beacon — second XIAO for the green-ring desk test.
 *
 * Only advertises Nearby manufacturer data (no ring, no scan required).
 * Flash this onto the board WITHOUT the LED ring.
 * Keep ble-ring-green-test on the board WITH the ring.
 */

#include <Arduino.h>
#include <Adafruit_TinyUSB.h>
#include <bluefruit.h>

#include "config.h"

static uint8_t localDeviceId[4];
static char bleDeviceName[12];
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

static void buildManufacturerPayload() {
  manufacturerPayload[0] = (uint8_t)(NEARBY_COMPANY_ID & 0xFF);
  manufacturerPayload[1] = (uint8_t)(NEARBY_COMPANY_ID >> 8);
  manufacturerPayload[2] = NEARBY_MAGIC[0];
  manufacturerPayload[3] = NEARBY_MAGIC[1];
  memcpy(&manufacturerPayload[4], localDeviceId, 4);
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

void setup() {
  Serial.begin(115200);
  const uint32_t t0 = millis();
  while (!Serial && (millis() - t0) < 2000) {
    delay(10);
  }

  initLocalDeviceId();
  buildManufacturerPayload();

  if (!Bluefruit.begin(1, 0)) {
    Serial.println("Bluefruit.begin failed");
    while (1) delay(100);
  }

  Bluefruit.setTxPower(4);
  Bluefruit.setName(bleDeviceName);
  startAdvertising();

  Serial.println();
  Serial.println("BLE peer beacon (no ring)");
  Serial.printf("Advertising as %s\n", bleDeviceName);
  Serial.printf("Device ID %02X%02X%02X%02X\n", localDeviceId[0], localDeviceId[1],
                localDeviceId[2], localDeviceId[3]);
  Serial.println("Leave this powered. Ring board should go GREEN when nearby.");
}

void loop() {
  delay(1000);
}
