#include "round_display.h"

#include <Adafruit_GC9A01A.h>
#include <Arduino.h>
#include <SPI.h>

// Same wiring as firmware/round-display. D1 is chip select, so the
// backup button lives on D0. D9 is the SPI peripheral's unused input.
static constexpr int8_t kCs = D1;
static constexpr int8_t kDc = D2;
static constexpr int8_t kRst = D3;
static constexpr uint8_t kMiso = D9;
static constexpr uint8_t kSck = D8;
static constexpr uint8_t kMosi = D10;
static constexpr uint32_t kSpiHz = 16000000;
static constexpr int16_t kScreen = 240;

static Adafruit_GC9A01A tft(kCs, kDc, kRst);
static bool ready = false;
static PendantFace shown = PendantFace::Idle;

static uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

static void paint(PendantFace face) {
  const char *title = "Nearby";
  const char *detail = "Say hello";
  uint16_t accent = rgb565(13, 148, 136);
  switch (face) {
    case PendantFace::Listening:
      title = "Listening";
      detail = "Talk";
      accent = rgb565(125, 211, 252);
      break;
    case PendantFace::Holding:
      title = "Holding";
      detail = "Phone away";
      accent = rgb565(245, 158, 11);
      break;
    case PendantFace::Sending:
      title = "Sending";
      detail = "Phone back";
      accent = rgb565(13, 148, 136);
      break;
    case PendantFace::Clip:
      title = "Clip";
      detail = "3 seconds";
      accent = rgb565(255, 255, 255);
      break;
    case PendantFace::Idle:
    default:
      break;
  }

  tft.fillScreen(GC9A01A_BLACK);
  tft.drawCircle(kScreen / 2, kScreen / 2, 116, accent);
  tft.drawCircle(kScreen / 2, kScreen / 2, 112, accent);
  tft.setTextWrap(false);
  tft.setTextColor(GC9A01A_WHITE);
  tft.setTextSize(3);

  int16_t x = 0;
  int16_t y = 0;
  uint16_t w = 0;
  uint16_t h = 0;
  tft.getTextBounds(title, 0, 0, &x, &y, &w, &h);
  tft.setCursor((kScreen - (int16_t)w) / 2, 100);
  tft.print(title);

  tft.setTextSize(2);
  tft.setTextColor(accent);
  tft.getTextBounds(detail, 0, 0, &x, &y, &w, &h);
  tft.setCursor((kScreen - (int16_t)w) / 2, 140);
  tft.print(detail);
}

static void fillAndMark(uint16_t color, const char *name) {
  Serial.printf("[display] fill %s\n", name);
  tft.fillScreen(color);
  delay(400);
}

void roundDisplayBegin() {
  Serial.println("[display] setPins MISO=D9 SCK=D8 MOSI=D10");
  SPI.setPins(kMiso, kSck, kMosi);
  Serial.printf("[display] begin %lu Hz CS=D1 DC=D2 RST=D3\n",
                static_cast<unsigned long>(kSpiHz));
  tft.begin(kSpiHz);
  ready = true;
  tft.setRotation(0);
  tft.invertDisplay(false);
  // Wiring check. A black glass that never leaves these colors is SPI or power.
  fillAndMark(GC9A01A_RED, "red");
  fillAndMark(GC9A01A_GREEN, "green");
  fillAndMark(GC9A01A_BLUE, "blue");
  Serial.println("[display] color sweep done; painting Nearby");
  paint(PendantFace::Idle);
  shown = PendantFace::Idle;
  Serial.println("[display] GC9A01 ready");
}

bool roundDisplayReady() { return ready; }

void roundDisplayShow(PendantFace face) {
  if (!ready || face == shown) return;
  Serial.printf("[display] face %u -> %u\n", static_cast<unsigned>(shown),
                static_cast<unsigned>(face));
  paint(face);
  shown = face;
}

void roundDisplayWatch() {
  static uint32_t lastMs = 0;
  const uint32_t now = millis();
  if (now - lastMs < 2000) return;
  lastMs = now;
  Serial.printf("[display] watch ready=%d face=%u up_ms=%lu\n", ready ? 1 : 0,
                static_cast<unsigned>(shown), static_cast<unsigned long>(now));
}
