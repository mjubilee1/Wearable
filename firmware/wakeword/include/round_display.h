#pragma once

#include <stdint.h>

// Status on the GC9A01. Drawn only when the face changes, from loop(),
// so a frame never sits in the microphone path.
enum class PendantFace : uint8_t {
  Idle = 0,
  Listening,
  Holding,
  Sending,
  Clip,
};

void roundDisplayBegin();
bool roundDisplayReady();
void roundDisplayShow(PendantFace face);
