#pragma once

#include <Arduino.h>

// Audio is mono signed PCM16 at 16 kHz throughout the pipeline.
static constexpr uint32_t kSampleRateHz = 16000;
static constexpr size_t kPdmReadSamples = 256;
static constexpr size_t kAudioRingSamples = 4096;  // 256 ms; absorbs BLE stalls.
static constexpr size_t kBlePacketSamples = 80;    // 160 bytes per notification.

#ifndef NEARBY_BUTTON_PIN
#define NEARBY_BUTTON_PIN 1
#endif

// Set to a GPIO connected to a transistor-driven haptic motor, never directly
// to a motor. -1 leaves haptics disabled and uses the onboard LED only.
#ifndef NEARBY_HAPTIC_PIN
#define NEARBY_HAPTIC_PIN -1
#endif

#ifndef NEARBY_WAKE_THRESHOLD
#define NEARBY_WAKE_THRESHOLD 0.85f
#endif

#ifndef NEARBY_SILENCE_RMS
#define NEARBY_SILENCE_RMS 500
#endif

#ifndef NEARBY_SILENCE_MS
#define NEARBY_SILENCE_MS 1200
#endif

#ifndef NEARBY_MAX_CAPTURE_MS
#define NEARBY_MAX_CAPTURE_MS 10000
#endif

// Nearby Voice service. PCM packets are raw little-endian int16 samples.
static const char kVoiceServiceUuid[] =
    "4E421000-0000-1000-8000-00805F9B34FB";
static const char kAudioCharacteristicUuid[] =
    "4E421001-0000-1000-8000-00805F9B34FB";
static const char kWakeSettingsCharacteristicUuid[] =
    "4E421002-0000-1000-8000-00805F9B34FB";
static const char kWakeEventCharacteristicUuid[] =
    "4E421003-0000-1000-8000-00805F9B34FB";

// Settings characteristic payload:
//   byte 0: 0 = wake word disabled, nonzero = enabled
//   byte 1: confidence threshold as 0..100 (85 means 0.85)
struct __attribute__((packed)) WakeSettings {
  uint8_t enabled;
  uint8_t thresholdPercent;
};

enum class TriggerSource : uint8_t {
  WakeWord = 1,
  Button = 2,
};
