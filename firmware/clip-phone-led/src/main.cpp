/**
 * Clip phone-led — advertise Nearby + accept LED color from phone over GATT.
 *
 * - No peer RSSI scanning. The phone is the only scanner.
 * - Ring solid GREEN only when the phone writes CLIP_LED_GREEN.
 * - Stale timeout clears the ring if the phone stops refreshing.
 *
 * Flash onto boards with the ring on D6. Serial 115200 for local id.
 */

#include <Arduino.h>
#include <Adafruit_TinyUSB.h>
#include <bluefruit.h>
#include <Adafruit_NeoPixel.h>

#include "config.h"

static uint8_t localDeviceId[4];
static char bleDeviceName[12];
static uint8_t manufacturerPayload[8];

static uint8_t ledState = CLIP_LED_OFF;
static uint32_t ledLastCommandAtMs = 0;

static Adafruit_NeoPixel ledRing(NEARBY_LED_COUNT, NEARBY_NEOPIXEL_PIN,
                                 NEO_GRB + NEO_KHZ800);

static BLEService ledService(NEARBY_LED_SERVICE_UUID);
static BLECharacteristic colorChar(NEARBY_LED_COLOR_CHAR_UUID);

static void logLocalId() {
  Serial.printf("[ble] local name %s\n", bleDeviceName);
  Serial.printf("[ble] local id %02X%02X%02X%02X\n", localDeviceId[0],
                localDeviceId[1], localDeviceId[2], localDeviceId[3]);
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

static void buildManufacturerPayload() {
  manufacturerPayload[0] = (uint8_t)(NEARBY_COMPANY_ID & 0xFF);
  manufacturerPayload[1] = (uint8_t)(NEARBY_COMPANY_ID >> 8);
  manufacturerPayload[2] = NEARBY_MAGIC[0];
  manufacturerPayload[3] = NEARBY_MAGIC[1];
  memcpy(&manufacturerPayload[4], localDeviceId, 4);
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

static void applyLedState(uint8_t state) {
  ledState = state;
  ledLastCommandAtMs = millis();
  if (state == CLIP_LED_GREEN) {
    fillRingGreen();
  } else {
    clearRing();
  }
}

static void color_write_callback(uint16_t conn_hdl, BLECharacteristic *chr,
                                 uint8_t *data, uint16_t len) {
  (void)conn_hdl;
  (void)chr;
  if (len < 1 || data == nullptr) return;

  const uint8_t next = data[0] == CLIP_LED_GREEN ? CLIP_LED_GREEN : CLIP_LED_OFF;
  applyLedState(next);
  Serial.printf("[led] phone write → %s\n",
                next == CLIP_LED_GREEN ? "GREEN" : "OFF");
}

static void startAdvertising() {
  Bluefruit.Advertising.clearData();
  Bluefruit.ScanResponse.clearData();
  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addManufacturerData(manufacturerPayload,
                                            sizeof(manufacturerPayload));
  // Service UUID in scan response — ADV packet is full with manufacturer data.
  Bluefruit.ScanResponse.addName();
  Bluefruit.ScanResponse.addUuid(ledService.uuid);

  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(ADV_INTERVAL_FAST, ADV_INTERVAL_SLOW);
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);
}

static void setupGatt() {
  ledService.begin();

  colorChar.setProperties(CHR_PROPS_READ | CHR_PROPS_WRITE |
                          CHR_PROPS_WRITE_WO_RESP);
  colorChar.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  colorChar.setFixedLen(1);
  colorChar.begin();
  colorChar.write8(CLIP_LED_OFF);
  colorChar.setWriteCallback(color_write_callback);
}

static void connect_callback(uint16_t conn_handle) {
  (void)conn_handle;
  Serial.println("[ble] phone connected");
}

static void disconnect_callback(uint16_t conn_handle, uint8_t reason) {
  (void)conn_handle;
  Serial.printf("[ble] phone disconnected reason=0x%02X\n", reason);
  // Leave LED as last phone command; stale timeout clears if no refresh.
}

void setup() {
  Serial.begin(115200);
  const uint32_t serialWaitStartedAtMs = millis();
  while (!Serial && (millis() - serialWaitStartedAtMs) < 2000) {
    delay(10);
  }

  initLocalDeviceId();
  buildManufacturerPayload();

  ledRing.begin();
  ledRing.setBrightness(NEARBY_LED_BRIGHTNESS);
  clearRing();

  Serial.println();
  Serial.println("======== clip phone-led ========");
  Serial.println("Ring green only from phone GATT write (not peer RSSI)");

  if (!Bluefruit.begin(1, 0)) {
    Serial.println("[ble] Bluefruit.begin FAILED");
    while (1) delay(100);
  }

  Bluefruit.setTxPower(0);
  Bluefruit.setName(bleDeviceName);
  Bluefruit.Periph.setConnectCallback(connect_callback);
  Bluefruit.Periph.setDisconnectCallback(disconnect_callback);

  setupGatt();
  startAdvertising();

  logLocalId();
  Serial.printf("[ble] LED service %s\n", NEARBY_LED_SERVICE_UUID);
  Serial.printf("[ble] color char  %s\n", NEARBY_LED_COLOR_CHAR_UUID);
  Serial.printf("[led] pin D%d  count %d  brightness %d  stale %lu ms\n",
                NEARBY_NEOPIXEL_PIN, NEARBY_LED_COUNT, NEARBY_LED_BRIGHTNESS,
                (unsigned long)LED_COMMAND_STALE_MS);
  Serial.println("======== ready ========");
}

void loop() {
  if (ledState == CLIP_LED_GREEN &&
      (millis() - ledLastCommandAtMs) > LED_COMMAND_STALE_MS) {
    applyLedState(CLIP_LED_OFF);
    Serial.println("[led] stale — ring OFF");
  }
  delay(40);
}
