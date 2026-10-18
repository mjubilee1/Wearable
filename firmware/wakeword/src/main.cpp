#include <Arduino.h>
#include <Adafruit_TinyUSB.h>
#include <PDM.h>
#include <bluefruit.h>
#include <math.h>
#include <nrf_gpio.h>
#include <nrf_soc.h>
#include <string.h>

#include "battery.h"
#include "clock.h"
#include "config.h"
#include "round_display.h"
#include "turn_cache.h"
#include "wakeword_model.h"

// Momentary button between this pin and GND. Active low, internal pull-up.
static constexpr uint8_t kButtonPin = NEARBY_BUTTON_PIN;
static constexpr uint32_t kButtonDebounceMs = 30;
// A shorter press is a tap. On a dark glass that tap only wakes the clock.
static constexpr uint32_t kButtonHoldMs = 300;
static constexpr uint32_t kButtonLongPressMs = 3000;
static constexpr uint32_t kGoodbyeMs = 1000;

// PDM callback -> ring buffer -> either local inference (idle) or BLE (active).
// There is deliberately no BLE notify call in the idle path.
static int16_t audioRing[kAudioRingSamples];
static volatile size_t ringWrite = 0;
static volatile size_t ringRead = 0;
static volatile uint32_t droppedSamples = 0;
static int16_t pdmReadBuffer[kPdmReadSamples];

static BLEService voiceService(kVoiceServiceUuid);
static BLECharacteristic audioCharacteristic(kAudioCharacteristicUuid);
static BLECharacteristic settingsCharacteristic(
    kWakeSettingsCharacteristicUuid);
static BLECharacteristic eventCharacteristic(kWakeEventCharacteristicUuid);
static BLECharacteristic replyCharacteristic(kReplyCharacteristicUuid);

static WakeSettings wakeSettings = {
    1, static_cast<uint8_t>(NEARBY_WAKE_THRESHOLD * 100.0f + 0.5f)};
static bool capturing = false;
static bool pttActive = false;
static uint32_t captureStartedAtMs = 0;
static uint32_t lastSpeechAtMs = 0;
static uint32_t detectionCount = 0;
static uint32_t falseTriggerCount = 0;  // Manually marked over Serial with 'f'.
static uint32_t lastDetectionAtMs = 0;
static bool lastDetectionMarkedFalse = false;
static uint16_t connectionHandle = BLE_CONN_HANDLE_INVALID;
static bool modelReady = false;
static bool holdingTurn = false;
static bool replayEventSent = false;
static uint8_t turnSource = 0;
static uint8_t turnConfidence = 0;

static int16_t *inferenceWindow = nullptr;
static size_t inferenceWindowSamples = 0;
static size_t inferenceSamplesFilled = 0;

// One training clip, only after the host sends 'c'. The samples leave over
// USB serial and are not written to flash or notified over BLE.
static int16_t *clipWindow = nullptr;
static size_t clipSamplesFilled = 0;
static bool clipArmed = false;
static uint32_t clipStartedAtMs = 0;

static void onPdmData() {
  const int bytesAvailable = PDM.available();
  if (bytesAvailable <= 0) return;

  const int bytesToRead =
      min(bytesAvailable, static_cast<int>(sizeof(pdmReadBuffer)));
  const int bytesRead = PDM.read(pdmReadBuffer, bytesToRead);
  const size_t samplesRead = bytesRead > 0 ? bytesRead / sizeof(int16_t) : 0;

  for (size_t i = 0; i < samplesRead; ++i) {
    const size_t nextWrite = (ringWrite + 1) % kAudioRingSamples;
    if (nextWrite == ringRead) {
      ++droppedSamples;
      break;
    }
    audioRing[ringWrite] = pdmReadBuffer[i];
    ringWrite = nextWrite;
  }
}

static size_t popAudio(int16_t *out, size_t capacity) {
  size_t count = 0;
  noInterrupts();
  while (count < capacity && ringRead != ringWrite) {
    out[count++] = audioRing[ringRead];
    ringRead = (ringRead + 1) % kAudioRingSamples;
  }
  interrupts();
  return count;
}

static void clearAudioRing() {
  noInterrupts();
  ringRead = ringWrite;
  interrupts();
}

static void cueTrigger() {
  // XIAO LEDs are active-low. Keep this short so it is a cue, not a power load.
  digitalWrite(LED_BUILTIN, LOW);
  if (NEARBY_HAPTIC_PIN >= 0) digitalWrite(NEARBY_HAPTIC_PIN, HIGH);
  delay(80);
  digitalWrite(LED_BUILTIN, HIGH);
  if (NEARBY_HAPTIC_PIN >= 0) digitalWrite(NEARBY_HAPTIC_PIN, LOW);
}

static void beginHold() {
  if (holdingTurn) return;
  holdingTurn = true;
  replayEventSent = false;
  if (!turnCacheAvailable()) {
    Serial.println("[cache] no onboard flash; this turn will be dropped");
    return;
  }
  turnCacheStart(turnSource, turnConfidence);
}

static void drainRingToCache() {
  if (!holdingTurn || !turnCacheAvailable()) return;
  int16_t packet[kBlePacketSamples];
  for (;;) {
    const size_t count = popAudio(packet, kBlePacketSamples);
    if (count == 0) return;
    if (turnCacheAppend(packet, count) != CacheWrite::Ok) return;
  }
}

static void stopCapture(const char *reason) {
  if (!capturing) return;
  if (holdingTurn) drainRingToCache();
  const bool savedForLater = holdingTurn;
  capturing = false;
  inferenceSamplesFilled = 0;
  clearAudioRing();
  if (holdingTurn) turnCacheFinish();
  holdingTurn = false;
  Serial.printf("[capture] stop reason=%s duration_ms=%lu\n", reason,
                static_cast<unsigned long>(millis() - captureStartedAtMs));
  // Sleep paints Goodbye itself. A critical cell stays dark.
  if (batteryCritical() ||
      (reason != nullptr && strcmp(reason, "sleep") == 0)) {
    return;
  }
  if (savedForLater) {
    showNotice("Phone away", "Saved until it reconnects");
    Serial.println("[state] holding");
  } else {
    showThinking();
    Serial.println("[state] thinking");
  }
}

static void startCapture(TriggerSource source, float confidence) {
  if (capturing) return;

  if (source == TriggerSource::WakeWord) {
    ++detectionCount;
    lastDetectionAtMs = millis();
    lastDetectionMarkedFalse = false;
    Serial.printf(
        "[wake] detected confidence=%.3f threshold=%.2f detections=%lu "
        "false_triggers=%lu\n",
        confidence, wakeSettings.thresholdPercent / 100.0f,
        static_cast<unsigned long>(detectionCount),
        static_cast<unsigned long>(falseTriggerCount));
  } else {
    Serial.println("[button] push to talk");
  }

  cueTrigger();
  onWakeWord();
  clearAudioRing();  // Start with speech after the trigger, not the wake phrase.
  captureStartedAtMs = millis();
  lastSpeechAtMs = captureStartedAtMs;
  capturing = true;
  holdingTurn = false;
  turnSource = static_cast<uint8_t>(source);
  turnConfidence =
      static_cast<uint8_t>(constrain(confidence * 100.0f, 0.0f, 100.0f));
  Serial.println("[state] listening");

  const uint8_t event[] = {turnSource, turnConfidence};
  if (connectionHandle != BLE_CONN_HANDLE_INVALID) {
    eventCharacteristic.notify(event, sizeof(event));
    Serial.println("[capture] streaming PCM16/16k mono");
  } else {
    beginHold();
    Serial.println("[capture] phone out of range; holding this turn");
  }
}

static uint16_t blePacketSamples() {
  if (connectionHandle == BLE_CONN_HANDLE_INVALID) return 0;
  BLEConnection *connection = Bluefruit.Connection(connectionHandle);
  if (connection == nullptr) return 0;
  const uint16_t mtu = connection->getMtu();
  const uint16_t payloadBytes = mtu > 3 ? mtu - 3 : 20;
  return min<uint16_t>(kBlePacketSamples, payloadBytes / sizeof(int16_t));
}

static void rememberSpeech(const int16_t *samples, size_t count) {
  uint64_t sumSquares = 0;
  for (size_t i = 0; i < count; ++i) {
    const int32_t sample = samples[i];
    sumSquares += static_cast<uint64_t>(sample * sample);
  }
  const float rms = sqrtf(static_cast<float>(sumSquares) / count);
  if (rms >= NEARBY_SILENCE_RMS) lastSpeechAtMs = millis();
}

static void processCaptureAudio() {
  int16_t packet[kBlePacketSamples];
  const uint16_t packetCapacity = blePacketSamples();
  if (packetCapacity == 0) beginHold();

  const size_t count = popAudio(packet, holdingTurn ? kBlePacketSamples
                                                    : packetCapacity);
  if (count == 0) {
    // Fall through to the stop checks below.
  } else if (holdingTurn) {
    const CacheWrite wrote = turnCacheAppend(packet, count);
    if (wrote == CacheWrite::Full) {
      stopCapture("cache_full");
      return;
    }
    rememberSpeech(packet, count);
  } else if (!audioCharacteristic.notify(reinterpret_cast<uint8_t *>(packet),
                                         count * sizeof(int16_t))) {
    Serial.println("[ble] audio notification dropped; holding the rest");
    beginHold();
    if (turnCacheAppend(packet, count) == CacheWrite::Full) {
      stopCapture("cache_full");
      return;
    }
    rememberSpeech(packet, count);
  } else {
    rememberSpeech(packet, count);
  }

  const uint32_t now = millis();
  if (pttActive) {
    // The hold is the utterance. Silence must not cut it off.
    if (now - captureStartedAtMs >= NEARBY_MAX_CAPTURE_MS) {
      stopCapture("max_10s");
    }
    return;
  }
  if (now - captureStartedAtMs >= NEARBY_MAX_CAPTURE_MS) {
    stopCapture("max_10s");
  } else if (now - captureStartedAtMs > 500 &&
             now - lastSpeechAtMs >= NEARBY_SILENCE_MS) {
    stopCapture("silence");
  }
}

static void processWakeWordAudio() {
  if (!wakeSettings.enabled || !modelReady || inferenceWindow == nullptr) {
    int16_t discard[kPdmReadSamples];
    popAudio(discard, kPdmReadSamples);
    return;
  }

  inferenceSamplesFilled +=
      popAudio(inferenceWindow + inferenceSamplesFilled,
               inferenceWindowSamples - inferenceSamplesFilled);
  if (inferenceSamplesFilled < inferenceWindowSamples) return;

  const float confidence =
      wakeword_model::score(inferenceWindow, inferenceWindowSamples);
  inferenceSamplesFilled = 0;
  if (confidence >= wakeSettings.thresholdPercent / 100.0f) {
    startCapture(TriggerSource::WakeWord, confidence);
  }
}

static void onReplyWrite(uint16_t, BLECharacteristic *, uint8_t *data,
                         uint16_t length) {
  if (data == nullptr || length == 0) return;
  char text[kReplyMaxBytes + 1];
  const uint16_t count = length > kReplyMaxBytes ? kReplyMaxBytes : length;
  memcpy(text, data, count);
  text[count] = '\0';
  showReply(String(text));
  Serial.printf("[display] reply bytes=%u\n", static_cast<unsigned>(count));
}

static void onSettingsWrite(uint16_t, BLECharacteristic *, uint8_t *data,
                            uint16_t length) {
  if (data == nullptr || length != sizeof(WakeSettings)) {
    Serial.println("[settings] ignored: expected [enabled, threshold 0..100]");
    return;
  }

  wakeSettings.enabled = data[0] ? 1 : 0;
  wakeSettings.thresholdPercent = constrain(data[1], 1, 100);
  settingsCharacteristic.write(&wakeSettings, sizeof(wakeSettings));
  inferenceSamplesFilled = 0;
  Serial.printf("[settings] wake=%s threshold=%.2f\n",
                wakeSettings.enabled ? "on" : "off",
                wakeSettings.thresholdPercent / 100.0f);
}

static void onConnect(uint16_t handle) {
  connectionHandle = handle;
  roundDisplaySetConnected(true);
  BLEConnection *connection = Bluefruit.Connection(handle);
  if (connection != nullptr) connection->requestMtuExchange(247);
  Serial.println("[ble] phone connected; requesting MTU 247");
}

static void onDisconnect(uint16_t, uint8_t reason) {
  connectionHandle = BLE_CONN_HANDLE_INVALID;
  roundDisplaySetConnected(false);
  // The open turn keeps running until silence or 10 s, and the unsent part
  // is held. A replay that was in progress starts over on the next connection.
  if (capturing && !holdingTurn) beginHold();
  if (!capturing) {
    replayEventSent = false;
    turnCacheRewind();
  }
  Serial.printf("[ble] phone disconnected reason=0x%02X\n", reason);
}

static void setupBle() {
  // Bandwidth must be configured before begin() because it changes the
  // SoftDevice RAM allocation.
  Bluefruit.configPrphBandwidth(BANDWIDTH_MAX);
  if (!Bluefruit.begin(1, 0)) {
    Serial.println("[ble] Bluefruit.begin failed");
    while (true) delay(100);
  }
  uint8_t mac[6] = {};
  Bluefruit.getAddr(mac);
  char name[16];
  snprintf(name, sizeof(name), "Nearby %02X%02X", mac[1], mac[0]);
  Bluefruit.setName(name);
  Serial.printf("[ble] advertising as %s\n", name);
  Bluefruit.setTxPower(0);
  Bluefruit.Periph.setConnectCallback(onConnect);
  Bluefruit.Periph.setDisconnectCallback(onDisconnect);

  voiceService.begin();

  audioCharacteristic.setProperties(CHR_PROPS_NOTIFY);
  audioCharacteristic.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  audioCharacteristic.setMaxLen(kBlePacketSamples * sizeof(int16_t));
  audioCharacteristic.begin();

  settingsCharacteristic.setProperties(CHR_PROPS_READ | CHR_PROPS_WRITE |
                                       CHR_PROPS_WRITE_WO_RESP);
  settingsCharacteristic.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  settingsCharacteristic.setFixedLen(sizeof(WakeSettings));
  settingsCharacteristic.setWriteCallback(onSettingsWrite);
  settingsCharacteristic.begin();
  settingsCharacteristic.write(&wakeSettings, sizeof(wakeSettings));

  eventCharacteristic.setProperties(CHR_PROPS_NOTIFY);
  eventCharacteristic.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  eventCharacteristic.setFixedLen(2);
  eventCharacteristic.begin();

  replyCharacteristic.setProperties(CHR_PROPS_WRITE);
  replyCharacteristic.setPermission(SECMODE_NO_ACCESS, SECMODE_OPEN);
  replyCharacteristic.setMaxLen(kReplyMaxBytes);
  replyCharacteristic.setWriteCallback(onReplyWrite);
  replyCharacteristic.begin();
  clockAddService();

  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(voiceService);
  Bluefruit.ScanResponse.addName();
  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(32, 244);
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);
}

static bool microphoneOn = false;

static void startMicrophone() {
  if (microphoneOn) return;
#ifdef PIN_PDM_PWR
  pinMode(PIN_PDM_PWR, OUTPUT);
  digitalWrite(PIN_PDM_PWR, HIGH);
  delay(10);
#endif
  PDM.onReceive(onPdmData);
  PDM.setBufferSize(sizeof(pdmReadBuffer));
  PDM.setGain(30);
  if (!PDM.begin(1, kSampleRateHz)) {
    Serial.println("[mic] PDM.begin failed");
    while (true) delay(100);
  }
  microphoneOn = true;
  Serial.println("[mic] onboard PDM ready: PCM16 mono at 16 kHz");
}

static void stopMicrophone() {
  if (!microphoneOn) return;
  PDM.end();
#ifdef PIN_PDM_PWR
  digitalWrite(PIN_PDM_PWR, LOW);
#endif
  microphoneOn = false;
  clearAudioRing();
  inferenceSamplesFilled = 0;
  Serial.println("[mic] off");
}

static char hexDigit(uint8_t value) {
  return "0123456789abcdef"[value & 0x0f];
}

static void dumpClipWindow() {
  Serial.printf("[clip] samples=%lu rate=%lu\n",
                static_cast<unsigned long>(kTrainingClipSamples),
                static_cast<unsigned long>(kSampleRateHz));
  char line[96];
  const size_t perLine = 16;
  for (size_t base = 0; base < kTrainingClipSamples; base += perLine) {
    size_t used = 0;
    const char prefix[] = "[clip] ";
    for (size_t i = 0; prefix[i] != '\0'; ++i) line[used++] = prefix[i];
    const size_t count = min(perLine, kTrainingClipSamples - base);
    for (size_t i = 0; i < count; ++i) {
      const uint16_t bits = static_cast<uint16_t>(clipWindow[base + i]);
      if (i != 0) line[used++] = ' ';
      line[used++] = hexDigit(bits >> 12);
      line[used++] = hexDigit(bits >> 8);
      line[used++] = hexDigit(bits >> 4);
      line[used++] = hexDigit(bits);
    }
    line[used++] = '\n';
    Serial.write(reinterpret_cast<const uint8_t *>(line), used);
  }
  Serial.println("[clip] end");
}

static void beginClip() {
  if (capturing || clipArmed || clipWindow == nullptr) {
    Serial.println("[clip] busy");
    return;
  }
  clearAudioRing();
  clipSamplesFilled = 0;
  clipStartedAtMs = millis();
  clipArmed = true;
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("[clip] start");
}

static void processClip() {
  clipSamplesFilled += popAudio(clipWindow + clipSamplesFilled,
                                kTrainingClipSamples - clipSamplesFilled);
  if (clipSamplesFilled < kTrainingClipSamples) {
    if (millis() - clipStartedAtMs > 4500) {
      clipArmed = false;
      clipSamplesFilled = 0;
      digitalWrite(LED_BUILTIN, HIGH);
      clearAudioRing();
      Serial.println("[clip] abort mic timeout");
    }
    return;
  }

  digitalWrite(LED_BUILTIN, HIGH);
  dumpClipWindow();
  clipSamplesFilled = 0;
  clipArmed = false;
  clearAudioRing();
}

static void processSerialTuning() {
  if (!Serial.available()) return;
  const char command = Serial.read();
  if (command == 'c' || command == 'C') {
    beginClip();
  } else if ((command == 'f' || command == 'F') && lastDetectionAtMs != 0 &&
      !lastDetectionMarkedFalse) {
    ++falseTriggerCount;
    lastDetectionMarkedFalse = true;
    Serial.printf("[tuning] marked false trigger; detections=%lu false=%lu\n",
                  static_cast<unsigned long>(detectionCount),
                  static_cast<unsigned long>(falseTriggerCount));
  } else if (command == 's' || command == 'S') {
    Serial.printf(
        "[stats] wake=%s threshold=%.2f detections=%lu false=%lu "
        "dropped_samples=%lu placeholder=%s held_bytes=%lu\n",
        wakeSettings.enabled ? "on" : "off",
        wakeSettings.thresholdPercent / 100.0f,
        static_cast<unsigned long>(detectionCount),
        static_cast<unsigned long>(falseTriggerCount),
        static_cast<unsigned long>(droppedSamples),
        wakeword_model::isPlaceholder() ? "yes" : "no",
        static_cast<unsigned long>(turnCacheBytes()));
  }
}

static bool radioStopped = false;

static void stopRadio() {
  if (radioStopped) return;
  Bluefruit.Advertising.restartOnDisconnect(false);
  if (connectionHandle != BLE_CONN_HANDLE_INVALID) {
    Bluefruit.disconnect(connectionHandle);
    const uint32_t started = millis();
    while (connectionHandle != BLE_CONN_HANDLE_INVALID &&
           millis() - started < 500) {
      delay(10);
    }
  }
  if (Bluefruit.Advertising.isRunning()) Bluefruit.Advertising.stop();
  radioStopped = true;
  Serial.println("[ble] advertising stopped");
}

static void startRadio() {
  if (!radioStopped) return;
  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.start(0);
  radioStopped = false;
  Serial.println("[ble] advertising");
}

static void enterCriticalBattery() {
  Serial.println("[power] under 5%; screen and radio off, clock still running");
  clockSaveNow();
  stopCapture("low_battery");
  stopMicrophone();
  stopRadio();
  roundDisplayForceSleep();
}

static void leaveCriticalBattery() {
  Serial.println("[power] battery recovered");
  startMicrophone();
  startRadio();
  roundDisplayPowerOk();
  roundDisplayGlance();
}

struct ButtonDebounce {
  bool stableDown = false;
  bool lastRaw = false;
  uint32_t changedAtMs = 0;

  void reset() {
    lastRaw = digitalRead(kButtonPin) == LOW;
    stableDown = lastRaw;
    changedAtMs = millis();
  }

  bool poll(bool &pressed, bool &released) {
    const bool raw = digitalRead(kButtonPin) == LOW;
    const uint32_t now = millis();
    pressed = false;
    released = false;
    if (raw != lastRaw) {
      lastRaw = raw;
      changedAtMs = now;
    }
    if (now - changedAtMs >= kButtonDebounceMs && raw != stableDown) {
      stableDown = raw;
      pressed = raw;
      released = !raw;
    }
    return stableDown;
  }
};

static ButtonDebounce button;

static void clearSenseLatch() {
  NRF_P0->LATCH = NRF_P0->LATCH;
  NRF_P1->LATCH = NRF_P1->LATCH;
}

static void armButtonWake() {
  nrf_gpio_cfg_sense_input(digitalPinToPinName(kButtonPin), NRF_GPIO_PIN_PULLUP,
                           NRF_GPIO_PIN_SENSE_LOW);
  clearSenseLatch();
  Serial.printf("[button] D%u wake armed\n", kButtonPin);
}

static void disarmButtonWake() {
  pinMode(kButtonPin, INPUT_PULLUP);
  clearSenseLatch();
}

static void waitUntilButtonReleased() {
  uint32_t highSince = 0;
  while (true) {
    if (digitalRead(kButtonPin) != LOW) {
      if (highSince == 0) highSince = millis();
      if (millis() - highSince >= kButtonDebounceMs) return;
    } else {
      highSince = 0;
    }
    delay(5);
  }
}

static void beginPushToTalk() {
  if (pttActive || capturing || clipArmed) return;
  pttActive = true;
  startMicrophone();
  startCapture(TriggerSource::Button, 1.0f);
  if (!capturing) pttActive = false;
}

static void endPushToTalk() {
  if (!pttActive) return;
  pttActive = false;
  // Same ending as a wake-word turn: Thinking, or the held-turn notice.
  stopCapture("button_release");
}

static void wakeFromSystemSleep() {
  disarmButtonWake();
  startMicrophone();
  startRadio();
  roundDisplayResume();
  button.reset();
  Serial.println("[state] awake");
}

// Blocks in System ON until D0 is tapped. RTC2 keeps running.
static void sleepUntilShortTap() {
  button.reset();
  while (true) {
    bool pressed = false;
    bool released = false;
    button.poll(pressed, released);
    if (pressed) {
      Serial.println("[button] down");
      const uint32_t downAt = millis();
      while (true) {
        button.poll(pressed, released);
        if (released) {
          Serial.println("[button] up");
          if (millis() - downAt < kButtonLongPressMs) return;
          Serial.println("[button] long press while asleep");
          button.reset();
          break;
        }
        if (button.stableDown && millis() - downAt >= kButtonLongPressMs) {
          Serial.println("[button] held while asleep");
          waitUntilButtonReleased();
          button.reset();
          break;
        }
        delay(5);
      }
    }
    if (digitalRead(kButtonPin) != LOW) clearSenseLatch();
    waitForEvent();
  }
}

static void enterSystemOnSleep() {
  Serial.println("[state] goodbye");
  pttActive = false;
  if (capturing) stopCapture("sleep");
  roundDisplayShowGoodbye();
  delay(kGoodbyeMs);
  stopMicrophone();
  roundDisplaySuspend();
  stopRadio();
  waitUntilButtonReleased();
  armButtonWake();
  // Stay in System ON. System OFF resets RTC2, and the clock is that counter.
  sd_power_mode_set(NRF_POWER_MODE_LOWPWR);
  Serial.println("[state] asleep");
  Serial.flush();
  sleepUntilShortTap();
  wakeFromSystemSleep();
}

static void processButton() {
  if (clipArmed) return;
  bool pressed = false;
  bool released = false;
  const bool down = button.poll(pressed, released);

  // Under 5% the button only lights the clock. The microphone stays off.
  if (batteryCritical() || radioStopped) {
    if (pressed) {
      Serial.println("[button] down");
      roundDisplayGlance();
      Serial.println("[state] idle");
    }
    return;
  }

  static uint32_t downAtMs = 0;
  static bool holdStarted = false;
  static bool longHandled = false;
  static bool darkAtPress = false;

  if (pressed) {
    downAtMs = millis();
    holdStarted = false;
    longHandled = false;
    darkAtPress = roundDisplayAsleep();
    Serial.println("[button] down");
  }

  if (down && !longHandled && downAtMs != 0 &&
      millis() - downAtMs >= kButtonLongPressMs) {
    longHandled = true;
    Serial.println("[button] long press");
    enterSystemOnSleep();
    downAtMs = 0;
    holdStarted = false;
    button.reset();
    return;
  }

  if (down && !holdStarted && !longHandled && downAtMs != 0 &&
      millis() - downAtMs >= kButtonHoldMs) {
    holdStarted = true;
    beginPushToTalk();
  }

  if (released) {
    Serial.println("[button] up");
    if (pttActive) {
      endPushToTalk();
    } else if (!holdStarted && (darkAtPress || roundDisplayAsleep())) {
      roundDisplayGlance();
      Serial.println("[state] idle");
    } else if (!holdStarted) {
      Serial.println("[button] tap");
    }
    downAtMs = 0;
    holdStarted = false;
  }
}

void setup() {
  Serial.begin(115200);
  const uint32_t serialWaitStartedAtMs = millis();
  while (!Serial && millis() - serialWaitStartedAtMs < 1500) delay(10);

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);
  pinMode(kButtonPin, INPUT_PULLUP);
  button.reset();
  if (NEARBY_HAPTIC_PIN >= 0) {
    pinMode(NEARBY_HAPTIC_PIN, OUTPUT);
    digitalWrite(NEARBY_HAPTIC_PIN, LOW);
  }

  Serial.println("\nHello Nearby wake-word firmware");
  modelReady = wakeword_model::begin();
  inferenceWindowSamples = wakeword_model::requiredSamples();
  inferenceWindow = static_cast<int16_t *>(
      malloc(inferenceWindowSamples * sizeof(int16_t)));
  clipWindow = static_cast<int16_t *>(
      malloc(kTrainingClipSamples * sizeof(int16_t)));
  if (inferenceWindow == nullptr || clipWindow == nullptr) {
    Serial.println("[model] not enough RAM for inference window");
    while (true) delay(100);
  }

  setupBle();
  turnCacheBegin();
  startMicrophone();
  roundDisplayBegin();
  Serial.printf(
      "[ready] wake=on threshold=%.2f; button=D%u debounce=%lums hold=%lums "
      "long=%lums; display=%s; 's'=stats 'f'=false 'c'=one training clip\n",
      wakeSettings.thresholdPercent / 100.0f, kButtonPin,
      static_cast<unsigned long>(kButtonDebounceMs),
      static_cast<unsigned long>(kButtonHoldMs),
      static_cast<unsigned long>(kButtonLongPressMs),
      roundDisplayReady() ? "on" : "off");
}

static PendantFace pendantFace() {
  if (clipArmed) return PendantFace::Clip;
  if (pttActive || (capturing && !holdingTurn)) return PendantFace::Listening;
  if (capturing && holdingTurn) return PendantFace::Holding;
  if (turnCachePending()) {
    return connectionHandle == BLE_CONN_HANDLE_INVALID ? PendantFace::Holding
                                                       : PendantFace::Sending;
  }
  return PendantFace::Idle;
}

static void sendHeldTurn() {
  if (capturing || connectionHandle == BLE_CONN_HANDLE_INVALID ||
      !turnCachePending()) {
    return;
  }

  if (!replayEventSent) {
    uint8_t event[2];
    turnCacheEvent(event);
    if (!eventCharacteristic.notify(event, sizeof(event))) {
      delay(20);
      return;
    }
    replayEventSent = true;
    showThinking();
    Serial.println("[cache] phone back; sending the held turn");
  }

  uint8_t packet[kBlePacketSamples * sizeof(int16_t)];
  const uint16_t samples = blePacketSamples();
  if (samples == 0) return;
  const size_t nbytes = turnCachePeek(packet, samples * sizeof(int16_t));
  if (nbytes == 0) {
    turnCacheClear();
    replayEventSent = false;
    Serial.println("[cache] held turn delivered");
    return;
  }
  if (!audioCharacteristic.notify(packet, nbytes)) {
    delay(20);
    return;
  }
  turnCacheConsume(nbytes);
}

void loop() {
  processButton();
  processSerialTuning();

  // Under 5% the glass and the radio are off. RTC2 keeps the time.
  // System OFF would stop that clock, so the CPU only naps.
  if (batteryCritical()) {
    if (!radioStopped) enterCriticalBattery();
    roundDisplayWatch();
    __WFE();
    return;
  }
  if (radioStopped) leaveCriticalBattery();

  if (clipArmed) {
    processClip();
  } else if (capturing) {
    processCaptureAudio();
  } else if (turnCachePending() &&
             connectionHandle != BLE_CONN_HANDLE_INVALID) {
    sendHeldTurn();
  } else {
    processWakeWordAudio();
  }

  roundDisplayShow(pendantFace());
  roundDisplayWatch();

  // Nap between microphone and radio events. The panel also sleeps after
  // 20 idle seconds. Wake word and BLE still run, so this is not System OFF.
  if (ringRead == ringWrite) __WFE();
}
