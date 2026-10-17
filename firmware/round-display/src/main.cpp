/**
 * Glowing waveform on a 1.28" GC9A01 round display.
 *
 * Board: Seeed XIAO nRF52840 Sense (USB 2886:8045).
 * Panel: GC9A01, 240x240, Adafruit_GC9A01A, hardware SPI.
 *
 *   Display   XIAO
 *   GND       GND
 *   VCC       3V3
 *   SCK       D8
 *   MOSI      D10
 *   CS        D1
 *   DC        D2
 *   RST       D3
 *
 * The panel does not use MISO. D9 stays the SPI peripheral's unused input.
 * If the module has a BL pin, tie it to 3V3.
 *
 * This image is not the wake-word firmware. Wake word uses D1 as a button.
 */

#include <Adafruit_GC9A01A.h>
#include <Arduino.h>
#include <SPI.h>
#include <math.h>
#include <string.h>

static constexpr int8_t kCs = D1;
static constexpr int8_t kDc = D2;
static constexpr int8_t kRst = D3;
static constexpr uint8_t kMiso = D9;
static constexpr uint8_t kSck = D8;
static constexpr uint8_t kMosi = D10;

// 16 MHz keeps a readable image on breadboard jumpers. SPIM3 can do 32 MHz
// once SCK and MOSI are short.
static constexpr uint32_t kSpiHz = 16000000;

static constexpr int16_t kScreen = 240;
static constexpr int16_t kBandW = 176;
static constexpr int16_t kBandH = 100;
static constexpr int16_t kBandX = (kScreen - kBandW) / 2;
static constexpr int16_t kBandY = (kScreen - kBandH) / 2;
static constexpr int kCenterY = kBandH / 2;

static Adafruit_GC9A01A tft(kCs, kDc, kRst);
static uint16_t band[kBandW * kBandH];

static uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

static void addPixel(int x, int y, int r, int g, int b) {
  if ((unsigned)x >= kBandW || (unsigned)y >= kBandH) {
    return;
  }
  if (r < 0) {
    r = 0;
  }
  if (g < 0) {
    g = 0;
  }
  if (b < 0) {
    b = 0;
  }

  uint16_t *pixel = &band[y * kBandW + x];
  const uint16_t current = *pixel;
  int cr = (current >> 11) & 0x1F;
  int cg = (current >> 5) & 0x3F;
  int cb = current & 0x1F;
  cr += r >> 3;
  cg += g >> 2;
  cb += b >> 3;
  if (cr > 31) {
    cr = 31;
  }
  if (cg > 63) {
    cg = 63;
  }
  if (cb > 31) {
    cb = 31;
  }
  *pixel = (uint16_t)((cr << 11) | (cg << 5) | cb);
}

static void stampColumn(int x, int y, int radius, int r, int g, int b) {
  const int den = radius + 1;
  const int den2 = den * den;
  for (int dy = -radius; dy <= radius; ++dy) {
    const int distance = dy < 0 ? -dy : dy;
    const int falloff = den - distance;
    const int weight = falloff * falloff;
    const int rr = r * weight / den2;
    const int gg = g * weight / den2;
    const int bb = b * weight / den2;
    addPixel(x, y + dy, rr, gg, bb);
    if (distance * 2 <= radius) {
      addPixel(x - 1, y + dy, rr / 3, gg / 3, bb / 3);
      addPixel(x + 1, y + dy, rr / 3, gg / 3, bb / 3);
    }
  }
}

static void paintHalo(float breathe) {
  const int cx = kBandW / 2;
  const int cy = kCenterY;
  const int reach = 48;
  const int reach2 = reach * reach;
  for (int y = 0; y < kBandH; ++y) {
    const int dy = y - cy;
    const int dy2 = dy * dy;
    if (dy2 >= reach2) {
      continue;
    }
    for (int x = 0; x < kBandW; ++x) {
      const int dx = x - cx;
      const int d2 = dx * dx + dy2;
      if (d2 >= reach2) {
        continue;
      }
      const int shade = (reach2 - d2) * 22 / reach2;
      const int glow = (int)(shade * breathe);
      addPixel(x, y, glow / 6, glow / 2, glow);
    }
  }
}

static float envelope(int x) {
  const float t = (float)x / (float)(kBandW - 1);
  const float s = sinf(t * PI);
  return s * s;
}

static int waveY(int x, float time, float spatial, float speed, float scale) {
  const float p = (float)x * spatial;
  const float shape = sinf(p + time * speed) * 0.72f +
                      sinf(p * 2.05f - time * speed * 1.35f) * 0.28f;
  const float amp = (22.f + 5.f * sinf(time * 0.65f)) * scale * envelope(x);
  return kCenterY + (int)lroundf(shape * amp);
}

static void paintWave(const int16_t *ys, int radius, int r, int g, int b,
                      bool fillGaps) {
  stampColumn(0, ys[0], radius, r, g, b);
  for (int x = 1; x < kBandW; ++x) {
    const int y = ys[x];
    const int previous = ys[x - 1];
    const int gap = y > previous ? y - previous : previous - y;
    if (fillGaps && gap > 1) {
      for (int step = 1; step < gap; ++step) {
        const int mid = previous + (y - previous) * step / gap;
        stampColumn(x, mid, radius, r / 2, g / 2, b / 2);
      }
    }
    stampColumn(x, y, radius, r, g, b);
  }
}

static void sampleWave(int16_t *ys, float time, float spatial, float speed,
                       float scale) {
  for (int x = 0; x < kBandW; ++x) {
    ys[x] = (int16_t)waveY(x, time, spatial, speed, scale);
  }
}

static void render(float time) {
  int16_t echo[kBandW];
  int16_t voice[kBandW];
  memset(band, 0, sizeof(band));
  const float breathe = 0.72f + 0.28f * sinf(time * 0.9f);
  paintHalo(breathe);
  sampleWave(echo, time, 0.050f, 2.15f, 0.42f);
  sampleWave(voice, time, 0.082f, -1.55f, 1.00f);
  paintWave(echo, 7, 10, 36, 72, true);
  paintWave(voice, 8, 18, 70, 130, true);
  paintWave(voice, 3, 90, 220, 255, false);
  paintWave(voice, 1, 255, 255, 255, false);
  tft.drawRGBBitmap(kBandX, kBandY, band, kBandW, kBandH);
}

void setup() {
  Serial.begin(115200);
  const uint32_t started = millis();
  while (!Serial && (millis() - started) < 1500) {
    delay(10);
  }

  // Adafruit nRF52 order is MISO, SCK, MOSI. Call this before begin().
  SPI.setPins(kMiso, kSck, kMosi);
  tft.begin(kSpiHz);
  tft.setRotation(0);
  tft.fillScreen(GC9A01A_BLACK);

  const uint16_t rim = rgb565(0, 36, 48);
  tft.drawCircle(kScreen / 2, kScreen / 2, 115, rim);
  tft.drawCircle(kScreen / 2, kScreen / 2, 116, rgb565(0, 18, 28));

  Serial.println("GC9A01 waveform");
}

void loop() {
  const float time = millis() * 0.001f;
  render(time);
}
