/**
 * LED ring wiring test — one blue pixel chasing around 16 WS2812 LEDs.
 *
 * Wiring:
 *   Ring DIN -> XIAO D6
 *   Ring 5V  -> XIAO 5V
 *   Ring GND -> XIAO GND
 *
 * Optional: 300–500Ω on DIN; 100–1000µF across ring 5V/GND.
 */

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>

#ifndef NEARBY_NEOPIXEL_PIN
#define NEARBY_NEOPIXEL_PIN 6
#endif

#ifndef NEARBY_LED_COUNT
#define NEARBY_LED_COUNT 16
#endif

#ifndef NEARBY_LED_BRIGHTNESS
#define NEARBY_LED_BRIGHTNESS 40
#endif

static Adafruit_NeoPixel ring(NEARBY_LED_COUNT, NEARBY_NEOPIXEL_PIN,
                              NEO_GRB + NEO_KHZ800);

void setup() {
  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && (millis() - t0) < 1500) {
    delay(10);
  }

  ring.begin();
  ring.setBrightness(NEARBY_LED_BRIGHTNESS);
  ring.clear();
  ring.show();

  Serial.println();
  Serial.println("LED ring spin test");
  Serial.printf("Pin D%d  count %d  brightness %d\n", NEARBY_NEOPIXEL_PIN,
                NEARBY_LED_COUNT, NEARBY_LED_BRIGHTNESS);
}

void loop() {
  static int ledIndex = 0;

  ring.clear();
  // Blue on GRB rings = Color(0, 0, 255)
  ring.setPixelColor(ledIndex, ring.Color(0, 0, 255));
  ring.show();

  ledIndex = (ledIndex + 1) % NEARBY_LED_COUNT;
  delay(80);
}
