#include "ble_audio.h"

#include <Arduino.h>

void ble_audio_setup() {
#if NEARBY_HAS_BLE
  Serial.println("BLE audio is not implemented yet.");
#else
  Serial.println("BLE audio off. This chip has no radio, or the flag is 0.");
#endif
}
