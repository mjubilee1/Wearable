#pragma once

#include <Arduino.h>

namespace wakeword_model {

// The exported model decides this value. The placeholder uses a one-second
// window so the microphone/BLE path can be exercised before training.
size_t requiredSamples();

bool begin();

// Returns the "hello nearby" confidence in the range 0.0..1.0.
// The placeholder intentionally always returns 0.
float score(const int16_t *samples, size_t sampleCount);

bool isPlaceholder();

}  // namespace wakeword_model
