#pragma once

#include <Arduino.h>

// Audio is mono signed PCM16 at 16 kHz throughout the pipeline.
static constexpr uint32_t kSampleRateHz = 16000;
// Long enough for a slow "hello nearby" plus a little silence.
static constexpr size_t kTrainingClipSamples = kSampleRateHz * 3;
static constexpr size_t kPdmReadSamples = 256;
static constexpr size_t kAudioRingSamples = 4096;  // 256 ms; absorbs BLE stalls.
static constexpr size_t kBlePacketSamples = 80;    // 160 bytes per notification.

// D0 to GND, momentary. D1, D2, D3, D8, and D10 belong to the round display.
#ifndef NEARBY_BUTTON_PIN
#define NEARBY_BUTTON_PIN 0
#endif

// Set to a free GPIO on a transistor-driven haptic motor, never directly
// to a motor, and never to D0–D3 or D8–D10. -1 leaves haptics off.
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
// Phone writes the spoken reply here. UTF-8, at most 96 bytes, no terminator.
// The round face wraps it, then returns to the clock.
static const char kReplyCharacteristicUuid[] =
    "4E421004-0000-1000-8000-00805F9B34FB";
static constexpr uint16_t kReplyMaxBytes = 96;

// Clock service. The phone writes this on every connect. RTC2 keeps
// counting after that, including while the CPU sleeps. Eight bytes,
// little-endian: int32 Unix UTC seconds, then int32 offset seconds.
// Local time is the sum. Optional Current Time Service is 0x1805.
static const char kTimeServiceUuid[] =
    "4E421010-0000-1000-8000-00805F9B34FB";
static const char kTimeCharacteristicUuid[] =
    "4E421011-0000-1000-8000-00805F9B34FB";

// Little-endian. Local time = unixSeconds + offsetSeconds.
// unixSeconds is UTC. offsetSeconds is the phone's timezone offset.
struct __attribute__((packed)) TimeSync {
  int32_t unixSeconds;
  int32_t offsetSeconds;
};

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
