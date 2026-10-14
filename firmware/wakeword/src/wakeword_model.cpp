#include "wakeword_model.h"

// TODO(model): Export the trained Edge Impulse Arduino library into
// lib/nearby_wakeword_inferencing/. PlatformIO will then discover this header
// and compile the real adapter below without changing application code.
#if __has_include(<nearby_wakeword_inferencing.h>)
#include <nearby_wakeword_inferencing.h>
#define NEARBY_HAS_WAKEWORD_MODEL 1
#else
#define NEARBY_HAS_WAKEWORD_MODEL 0
#endif

namespace wakeword_model {

#if NEARBY_HAS_WAKEWORD_MODEL
namespace {
const int16_t *gSamples = nullptr;

int getSignalData(size_t offset, size_t length, float *out) {
  for (size_t i = 0; i < length; ++i) {
    out[i] = static_cast<float>(gSamples[offset + i]);
  }
  return 0;
}
}  // namespace

size_t requiredSamples() {
  return EI_CLASSIFIER_DSP_INPUT_FRAME_SIZE;
}

bool begin() {
  if (EI_CLASSIFIER_FREQUENCY != 16000) {
    Serial.printf("[model] expected 16 kHz, export is %lu Hz\n",
                  static_cast<unsigned long>(EI_CLASSIFIER_FREQUENCY));
    return false;
  }
  Serial.printf("[model] Edge Impulse ready: %lu samples, labels=%d\n",
                static_cast<unsigned long>(requiredSamples()),
                EI_CLASSIFIER_LABEL_COUNT);
  return true;
}

float score(const int16_t *samples, size_t sampleCount) {
  if (samples == nullptr || sampleCount != requiredSamples()) return 0.0f;

  gSamples = samples;
  signal_t signal = {};
  signal.total_length = sampleCount;
  signal.get_data = getSignalData;
  ei_impulse_result_t result = {};
  const EI_IMPULSE_ERROR error = run_classifier(&signal, &result, false);
  gSamples = nullptr;
  if (error != EI_IMPULSE_OK) {
    Serial.printf("[model] inference error=%d\n", error);
    return 0.0f;
  }

  float confidence = 0.0f;
  for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; ++i) {
    const char *label = result.classification[i].label;
    if (strcmp(label, "hello nearby") == 0 ||
        strcmp(label, "hello_nearby") == 0) {
      confidence = result.classification[i].value;
      break;
    }
  }
  return confidence;
}

bool isPlaceholder() { return false; }

#else

size_t requiredSamples() { return 16000; }

bool begin() {
  Serial.println(
      "[model] PLACEHOLDER active: copy the Edge Impulse export into "
      "lib/nearby_wakeword_inferencing");
  return true;
}

float score(const int16_t *, size_t) {
  // Safe default: a missing model must never open the microphone stream.
  return 0.0f;
}

bool isPlaceholder() { return true; }

#endif

}  // namespace wakeword_model
