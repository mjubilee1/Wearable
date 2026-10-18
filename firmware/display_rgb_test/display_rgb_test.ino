/*
  GC9A01 wiring test. Fills the round panel red, then green, then blue.

  Board package (Boards Manager):
    "Seeed nRF52 mbed-enabled Boards" by Seeed Studio, version 2.9.2 or newer.
  Tools > Board:
    Seeed nRF52 mbed-enabled Boards > Seeed XIAO nRF52840 Sense

  Libraries (Library Manager):
    Adafruit GC9A01A, Adafruit GFX Library, Adafruit BusIO.

  Wiring. The silkscreen says SCL/SDA. Those pins are SPI, not I2C.
    SCL -> D8    SDA -> D10    CS -> D1    DC -> D2    RST -> D3
    VCC -> 3V3   GND -> GND
  This module has no BL pin. Backlight power comes from VCC.

  Open this folder in the Arduino IDE. The folder name and the sketch
  name must match: display_rgb_test/display_rgb_test.ino

  Serial Monitor: 115200. It prints red, green, blue as the colors change.
  Uploading this replaces the wake-word firmware on the board.
*/

#include <Adafruit_GC9A01A.h>
#include <Adafruit_GFX.h>
#include <SPI.h>

// Library discovery compiles the sketch before the board headers exist.
#if ARDUINO_LIBRARY_DISCOVERY_PHASE != 1
#if !defined(PIN_SPI_SCK) || !defined(PIN_SPI_MOSI)
#error "Pick Seeed nRF52 mbed-enabled Boards > XIAO nRF52840 Sense (No Updates), version 2.9.2 or newer."
#endif

static_assert(D8 == PIN_SPI_SCK, "D8 is not the hardware SPI clock on this board package.");
static_assert(D10 == PIN_SPI_MOSI, "D10 is not the hardware SPI data pin on this board package.");
#endif

// 3-pin constructor: hardware SPI on D8 (SCK) and D10 (MOSI).
Adafruit_GC9A01A tft(D1, D2, D3);

const uint32_t SPI_HZ = 8000000;

void show(uint16_t color, const char *name) {
  Serial.println(name);
  tft.fillScreen(color);
  delay(1000);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("GC9A01 color test");
  Serial.println("SCK=D8 MOSI=D10 CS=D1 DC=D2 RST=D3");

  // Hold the panel in reset before the library's own reset pulse.
  // Jumper wires drop bits at 16 MHz; 8 MHz below matches this wire length.
  pinMode(D3, OUTPUT);
  digitalWrite(D3, LOW);
  delay(100);
  digitalWrite(D3, HIGH);
  delay(100);

  tft.begin(SPI_HZ);
  tft.setRotation(0);
  tft.invertDisplay(true);
  Serial.println("begin() done");
}

void loop() {
  show(GC9A01A_RED, "red");
  show(GC9A01A_GREEN, "green");
  show(GC9A01A_BLUE, "blue");
}
