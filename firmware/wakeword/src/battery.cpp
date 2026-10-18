#include "battery.h"

#include <Arduino.h>

// 1 MOhm + 510 kOhm divider. Enable stays LOW for the whole run.
// Driving VBAT_ENABLE high can put the raw cell on the ADC pin.
static constexpr float kDivider = 1510.0f / 510.0f;
static constexpr float kEmptyVolts = 3.3f;
static constexpr float kFullVolts = 4.2f;
static constexpr uint32_t kPeriodMs = 30000;
static constexpr int kCriticalEnter = 5;
static constexpr int kCriticalExit = 8;

static float volts = 0.0f;
static int percent = 0;
static bool ready = false;
static bool critical = false;
static uint32_t lastMs = 0;

static int percentFromVolts(float reading) {
  const float span = kFullVolts - kEmptyVolts;
  int value = static_cast<int>((reading - kEmptyVolts) * (100.0f / span) + 0.5f);
  if (value < 0) value = 0;
  if (value > 100) value = 100;
  return value;
}

static void sample() {
  uint32_t sum = 0;
  for (int i = 0; i < 16; ++i) sum += analogRead(PIN_VBAT);
  const float raw = static_cast<float>(sum) / 16.0f;
  const float atPin = (raw / 4096.0f) * 2.4f;
  const float reading = atPin * kDivider;
  // First sample seeds the average. Later samples move it slowly so a
  // single noisy read cannot jump the percent.
  volts = ready ? volts * 0.8f + reading * 0.2f : reading;
  percent = percentFromVolts(volts);
  ready = true;
  lastMs = millis();

  const bool present = volts >= 2.8f && volts <= 4.5f;
  if (!present) {
    critical = false;
  } else if (!critical && percent < kCriticalEnter) {
    critical = true;
  } else if (critical && percent >= kCriticalExit) {
    critical = false;
  }
  Serial.printf("[battery] %.2f V %d%%\n", volts, percent);
}

void batteryBegin() {
  pinMode(VBAT_ENABLE, OUTPUT);
  digitalWrite(VBAT_ENABLE, LOW);
  analogReadResolution(12);
  analogReference(AR_INTERNAL_2_4);
  analogSampleTime(40);
  delay(10);
  (void)analogRead(PIN_VBAT);
  sample();
}

void batteryPoll() {
  if (!ready || millis() - lastMs >= kPeriodMs) sample();
}

int batteryPercent() { return percent; }

bool batteryPresent() { return ready && volts >= 2.8f && volts <= 4.5f; }

bool batteryLow() { return batteryPresent() && percent < 15; }

bool batteryCritical() { return critical; }
