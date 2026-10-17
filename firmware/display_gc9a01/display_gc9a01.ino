/*
  Nearby round display
  Board:  Seeed XIAO nRF52840 Sense
  Panel:  Teyleten GC9A01, 1.28 inch, 240x240 round

  Open this folder in the Arduino IDE. The sketch name and the folder
  name must match: display_gc9a01/display_gc9a01.ino

  Board package (Boards Manager):
    "Seeed nRF52 mbed-enabled Boards" by Seeed Studio, version 2.9.2 or newer.
    Older releases have a broken PIN_VBAT and will not read the LiPo.
  Tools > Board:
    Seeed nRF52 mbed-enabled Boards > Seeed XIAO nRF52840 Sense

  Libraries (Library Manager). Install these three:
    1. Adafruit GC9A01A      by Adafruit
    2. Adafruit GFX Library  by Adafruit
    3. Adafruit BusIO        by Adafruit
       (Library Manager usually adds BusIO when you install GC9A01A.
        Install it yourself if the sketch says BusIO is missing.)

  Wiring. The module silkscreen says SCL/SDA, but this is SPI, not I2C.
    Module SCL  -> D8   (SCK,  hardware SPI clock)
    Module SDA  -> D10  (MOSI, hardware SPI data)
    Module CS   -> D1
    Module DC   -> D2
    Module RST  -> D3
    Module VCC  -> 3V3
    Module GND  -> GND
    Module BL   -> 3V3  (backlight always on; no backlight pin in code)
    LiPo 3.7 V 250 mAh -> the two BAT pads on the back of the XIAO.
    The cell is charged when USB is plugged in. Do not wire the cell
    to a GPIO.

  D1 is the display chip-select in this sketch. The wake-word firmware
  in firmware/wakeword uses D1 as its backup button. This file is a
  separate Arduino sketch. Flashing it replaces whatever is on the board.

  This sketch does not open the microphone. When your Edge Impulse
  "hello nearby" code accepts a wake, call onWakeWord() from loop().
  When the phone sends the spoken answer over BLE, call showReply().

  Screen states:
    IDLE       large 12-hour clock, battery icon near the bottom
    LISTENING  purple/white waveform in the center
    REPLY      short centered text, then back to the clock after 6 seconds
*/

#include <Adafruit_GC9A01A.h>
#include <Adafruit_GFX.h>
#include <SPI.h>
#include <math.h>
#include <string.h>

#if !defined(PIN_VBAT) || !defined(PIN_VBAT_ENABLE) || !defined(AR_INTERNAL2V4)
#error "Pick Seeed nRF52 mbed-enabled Boards > Seeed XIAO nRF52840 Sense, version 2.9.2 or newer."
#endif

// Hardware SPI uses the board's fixed SCK and MOSI pins. On this package
// those are D8 and D10, which is the wiring above. The 3-pin constructor
// is hardware SPI. The 5-pin constructor bit-bangs and is too slow here.
static_assert(D8 == PIN_SPI_SCK, "D8 is not the hardware SPI clock on this board package.");
static_assert(D10 == PIN_SPI_MOSI, "D10 is not the hardware SPI data pin on this board package.");

const int TFT_CS = D1;
const int TFT_DC = D2;
const int TFT_RST = D3;

// 16 MHz is reliable on jumper wires. 32000000 is fine on a short cable
// if the picture stays clean.
const uint32_t SPI_HZ = 16000000;
const uint8_t DISPLAY_ROTATION = 0;  // use 2 if the picture is upside down
const bool DISPLAY_INVERT = false;   // use true if black and white are swapped

const int16_t SCREEN = 240;
const int16_t CENTER = 120;
// The panel is square, but the glass is round. Keep drawings inside this
// circle so text and icons are not clipped by the bezel.
const int16_t SAFE_RADIUS = 100;

const uint32_t BATTERY_PERIOD_MS = 30000;
const uint32_t REPLY_HOLD_MS = 6000;
const uint32_t LISTEN_GIVE_UP_MS = 8000;
const uint32_t FRAME_MS = 33;

// Bench test. Set this to false once onWakeWord() and showReply() are
// called by the real wake-word and BLE code.
const bool BENCH_TEST = true;
const uint32_t BENCH_WAKE_EVERY_MS = 20000;
const uint32_t BENCH_LISTEN_MS = 4000;
const char BENCH_REPLY[] = "Hello Montrell, I'm listening.";

// 3.3 V is treated as empty, 4.2 V as full. A LiPo spends most of its
// life between those two numbers. The mapping is a straight line.
const float BATTERY_EMPTY_V = 3.3f;
const float BATTERY_FULL_V = 4.2f;

enum ScreenState {
  STATE_IDLE,
  STATE_LISTENING,
  STATE_REPLY
};

Adafruit_GC9A01A tft(TFT_CS, TFT_DC, TFT_RST);

// Waveform is drawn here, then copied to the panel in one shot.
// 160 x 64 x 2 bytes is about 20 KB. A full 240x240 canvas is unnecessary
// and would repaint pixels that are not changing.
const int16_t WAVE_W = 160;
const int16_t WAVE_H = 64;
const int16_t WAVE_X = (SCREEN - WAVE_W) / 2;
const int16_t WAVE_Y = (SCREEN - WAVE_H) / 2;
GFXcanvas16 waveCanvas(WAVE_W, WAVE_H);

ScreenState state = STATE_IDLE;
uint32_t stateEnteredMs = 0;
uint32_t lastWakeMs = 0;
uint32_t lastFrameMs = 0;
uint32_t lastBatteryMs = 0;
uint32_t clockOriginSeconds = 0;
float wavePhase = 0.0f;

char shownTime[8] = "";
bool shownIsPm = false;
bool clockDrawn = false;

float batteryVolts = 0.0f;
int batteryPercent = 0;
int drawnBatteryPercent = -1;

// onWakeWord() and showReply() only raise these flags. loop() does the
// drawing. That keeps SPI traffic out of a BLE callback or an interrupt.
volatile bool wakeRequested = false;
volatile bool replyRequested = false;
char pendingReply[97];
char activeReply[97];

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

// __TIME__ is the computer's clock at compile time, as "HH:MM:SS".
// The sketch adds millis() on top, so it keeps moving after upload.
// It has no real-time clock, so it drifts and resets on every reboot.
void captureCompileTime() {
  int hours = (__TIME__[0] - '0') * 10 + (__TIME__[1] - '0');
  int minutes = (__TIME__[3] - '0') * 10 + (__TIME__[4] - '0');
  int seconds = (__TIME__[6] - '0') * 10 + (__TIME__[7] - '0');
  clockOriginSeconds = (uint32_t)hours * 3600UL + (uint32_t)minutes * 60UL + (uint32_t)seconds;
}

void formatTime(char *out, size_t outLen, bool &isPm) {
  uint32_t elapsed = millis() / 1000UL;
  uint32_t secondsToday = (clockOriginSeconds + elapsed) % 86400UL;
  int hour24 = (int)(secondsToday / 3600UL);
  int minute = (int)((secondsToday / 60UL) % 60UL);
  isPm = hour24 >= 12;
  int hour12 = hour24 % 12;
  if (hour12 == 0) {
    hour12 = 12;
  }
  snprintf(out, outLen, "%d:%02d", hour12, minute);
}

// Widest clock text is "10:00" at size 6: 5 cells of 36 px = 180 px.
// The erase boxes below cover that, and both sit inside the 200 px circle.
void paintClock(const char *hhmm, bool isPm) {
  const int16_t timeX = 28;
  const int16_t timeY = 84;
  const int16_t timeW = 184;
  const int16_t timeH = 52;
  tft.fillRect(timeX, timeY, timeW, timeH, GC9A01A_BLACK);

  tft.setTextSize(6);
  tft.setTextColor(GC9A01A_WHITE);
  int16_t boundsX, boundsY;
  uint16_t boundsW, boundsH;
  tft.getTextBounds(hhmm, 0, 0, &boundsX, &boundsY, &boundsW, &boundsH);
  tft.setCursor((SCREEN - (int16_t)boundsW) / 2 - boundsX, timeY + 2 - boundsY);
  tft.print(hhmm);

  const char *ampm = isPm ? "PM" : "AM";
  const int16_t markX = 96;
  const int16_t markY = 140;
  tft.fillRect(markX, markY, 48, 20, GC9A01A_BLACK);
  tft.setTextSize(2);
  tft.getTextBounds(ampm, 0, 0, &boundsX, &boundsY, &boundsW, &boundsH);
  tft.setCursor((SCREEN - (int16_t)boundsW) / 2 - boundsX, markY - boundsY);
  tft.print(ampm);
}

void updateClock(bool force) {
  char buf[8];
  bool isPm = false;
  formatTime(buf, sizeof(buf), isPm);
  if (!force && clockDrawn && strcmp(buf, shownTime) == 0 && isPm == shownIsPm) {
    return;
  }
  strncpy(shownTime, buf, sizeof(shownTime) - 1);
  shownTime[sizeof(shownTime) - 1] = '\0';
  shownIsPm = isPm;
  clockDrawn = true;
  paintClock(buf, isPm);
}

// ---------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------

// The XIAO divides the cell through 1 MOhm + 510 kOhm.
// P0.14 enables that divider. On this core the Arduino pin is
// PIN_VBAT_ENABLE (32). Digital pin 14 is the blue LED, not the divider.
//
// Leave the enable LOW for the whole run, including while USB is charging.
// Driving it HIGH can put more than 3.6 V on the ADC pin. The divider
// itself draws about 3 uA, which is fine for a 250 mAh cell.
void startBatterySense() {
  pinMode(PIN_VBAT_ENABLE, OUTPUT);
  digitalWrite(PIN_VBAT_ENABLE, LOW);
  analogReference(AR_INTERNAL2V4);  // 2.4 V full scale
  analogReadResolution(12);         // counts run from 0 to 4095
  analogAcquisitionTime(AT_40_US);  // the divider is high impedance
  delay(10);
  (void)analogRead(PIN_VBAT);       // first sample is stale
}

float readBatteryVolts() {
  const int samples = 8;
  uint32_t sum = 0;
  for (int i = 0; i < samples; i++) {
    sum += analogRead(PIN_VBAT);
  }
  float raw = (float)sum / (float)samples;
  // nRF SAADC: counts / 4096 * reference, then undo the resistor divider.
  float atPin = (raw / 4096.0f) * 2.4f;
  return atPin * (1510.0f / 510.0f);
}

int percentFromVolts(float volts) {
  float span = BATTERY_FULL_V - BATTERY_EMPTY_V;
  int percent = (int)((volts - BATTERY_EMPTY_V) * (100.0f / span) + 0.5f);
  if (percent < 0) {
    return 0;
  }
  if (percent > 100) {
    return 100;
  }
  return percent;
}

void sampleBattery() {
  batteryVolts = readBatteryVolts();
  batteryPercent = percentFromVolts(batteryVolts);
  Serial.print("Battery ");
  Serial.print(batteryVolts, 2);
  Serial.print(" V, ");
  Serial.print(batteryPercent);
  Serial.println("%");
}

// Icon plus percent, centered, just inside the bottom of the safe circle.
void paintBattery(bool force) {
  if (!force && batteryPercent == drawnBatteryPercent) {
    return;
  }
  drawnBatteryPercent = batteryPercent;

  const int16_t slotX = 70;
  const int16_t slotY = 186;
  const int16_t slotW = 100;
  const int16_t slotH = 20;
  tft.fillRect(slotX, slotY, slotW, slotH, GC9A01A_BLACK);

  char label[8];
  snprintf(label, sizeof(label), "%d%%", batteryPercent);
  tft.setTextSize(2);
  tft.setTextWrap(false);
  int16_t boundsX, boundsY;
  uint16_t boundsW, boundsH;
  tft.getTextBounds(label, 0, 0, &boundsX, &boundsY, &boundsW, &boundsH);

  const int16_t bodyW = 26;
  const int16_t bodyH = 14;
  const int16_t nubW = 3;
  const int16_t gap = 6;
  int16_t groupW = bodyW + nubW + gap + (int16_t)boundsW;
  int16_t groupX = (SCREEN - groupW) / 2;
  int16_t bodyY = slotY + (slotH - bodyH) / 2;

  uint16_t color = batteryPercent <= 15 ? tft.color565(255, 72, 72) : GC9A01A_WHITE;
  tft.drawRoundRect(groupX, bodyY, bodyW, bodyH, 2, color);
  tft.fillRect(groupX + bodyW, bodyY + (bodyH - 6) / 2, nubW, 6, color);

  int16_t innerW = bodyW - 4;
  int16_t fillW = (int16_t)((innerW * batteryPercent) / 100);
  if (fillW > 0) {
    tft.fillRect(groupX + 2, bodyY + 2, fillW, bodyH - 4, color);
  }

  tft.setTextColor(color);
  int16_t textX = groupX + bodyW + nubW + gap - boundsX;
  int16_t textY = bodyY + (bodyH - (int16_t)boundsH) / 2 - boundsY;
  tft.setCursor(textX, textY);
  tft.print(label);
}

// ---------------------------------------------------------------------------
// Listening waveform
// ---------------------------------------------------------------------------

void paintWave() {
  uint16_t *pixels = waveCanvas.getBuffer();
  if (pixels == nullptr) {
    return;
  }

  waveCanvas.fillScreen(0);

  const int bars = 15;
  const int gap = 4;
  const int barW = 6;
  int used = bars * barW + (bars - 1) * gap;
  int origin = (WAVE_W - used) / 2;
  uint16_t glow = waveCanvas.color565(80, 28, 150);
  uint16_t mid = waveCanvas.color565(176, 110, 255);

  for (int i = 0; i < bars; i++) {
    float swell = 0.5f + 0.5f * sinf(wavePhase + i * 0.48f);
    float ripple = 0.5f + 0.5f * sinf(wavePhase * 1.7f + i * 0.85f);
    float level = swell * 0.72f + ripple * 0.28f;
    int barH = 8 + (int)(level * (WAVE_H - 14));
    if (barH > WAVE_H - 4) {
      barH = WAVE_H - 4;
    }
    int x = origin + i * (barW + gap);
    int y = (WAVE_H - barH) / 2;

    waveCanvas.fillRect(x, y, barW, barH, glow);
    if (barH > 8) {
      waveCanvas.fillRect(x + 1, y + 2, barW - 2, barH - 4, mid);
    }
    waveCanvas.drawFastVLine(x + barW / 2, y + 2, barH - 4, GC9A01A_WHITE);
  }

  // One rectangle write. The rest of the screen stays as it was.
  tft.drawRGBBitmap(WAVE_X, WAVE_Y, pixels, WAVE_W, WAVE_H);
}

// ---------------------------------------------------------------------------
// Reply text
// ---------------------------------------------------------------------------

int16_t textWidthOf(const char *text, uint8_t textSize) {
  int16_t boundsX, boundsY;
  uint16_t boundsW, boundsH;
  tft.setTextSize(textSize);
  tft.getTextBounds(text, 0, 0, &boundsX, &boundsY, &boundsW, &boundsH);
  return (int16_t)boundsW;
}

// How wide a line may be when its vertical center is at screen Y.
// The result is the chord of the 200 px circle, minus a few pixels.
int16_t chordWidthAt(int16_t screenY) {
  int16_t dy = screenY - CENTER;
  int32_t remaining = (int32_t)SAFE_RADIUS * SAFE_RADIUS - (int32_t)dy * dy;
  if (remaining <= 0) {
    return 0;
  }
  return (int16_t)(sqrtf((float)remaining) * 2.0f) - 8;
}

// Greedy word wrap. Returns the line count, or -1 if this size cannot
// keep every line inside the circle.
const int MAX_REPLY_LINES = 6;
const int MAX_REPLY_CHARS = 28;

int wrapReply(const char *message, uint8_t textSize, int16_t maxWidth,
              char lines[][MAX_REPLY_CHARS]) {
  int count = 0;
  const char *cursor = message;

  while (*cursor != '\0') {
    while (*cursor == ' ') {
      cursor++;
    }
    if (*cursor == '\0') {
      break;
    }
    if (count >= MAX_REPLY_LINES) {
      return -1;
    }

    char built[MAX_REPLY_CHARS];
    built[0] = '\0';
    const char *lineEnd = cursor;
    bool fittedWord = false;

    while (*cursor != '\0') {
      while (*cursor == ' ') {
        cursor++;
      }
      if (*cursor == '\0') {
        break;
      }
      const char *wordEnd = cursor;
      while (*wordEnd != '\0' && *wordEnd != ' ') {
        wordEnd++;
      }
      int wordLen = (int)(wordEnd - cursor);

      char trial[MAX_REPLY_CHARS];
      int builtLen = (int)strlen(built);
      int need = builtLen + (builtLen > 0 ? 1 : 0) + wordLen;
      if (need >= MAX_REPLY_CHARS) {
        break;
      }

      trial[0] = '\0';
      if (builtLen > 0) {
        snprintf(trial, sizeof(trial), "%s %.*s", built, wordLen, cursor);
      } else {
        snprintf(trial, sizeof(trial), "%.*s", wordLen, cursor);
      }

      if (textWidthOf(trial, textSize) <= maxWidth) {
        strncpy(built, trial, sizeof(built) - 1);
        built[sizeof(built) - 1] = '\0';
        lineEnd = wordEnd;
        cursor = wordEnd;
        fittedWord = true;
        continue;
      }

      // A single word wider than the line is split so the loop moves on.
      if (!fittedWord) {
        int keep = wordLen;
        while (keep > 1 && textWidthOf(trial, textSize) > maxWidth) {
          keep--;
          snprintf(trial, sizeof(trial), "%.*s", keep, cursor);
        }
        if (textWidthOf(trial, textSize) > maxWidth) {
          return -1;
        }
        strncpy(built, trial, sizeof(built) - 1);
        built[sizeof(built) - 1] = '\0';
        lineEnd = cursor + keep;
        fittedWord = true;
      }
      break;
    }

    if (!fittedWord) {
      return -1;
    }

    strncpy(lines[count], built, MAX_REPLY_CHARS - 1);
    lines[count][MAX_REPLY_CHARS - 1] = '\0';
    count++;
    cursor = lineEnd;
  }

  if (count == 0) {
    return -1;
  }

  int16_t lineH = 8 * textSize;
  int16_t gap = 4;
  int16_t blockH = count * lineH + (count - 1) * gap;
  int16_t top = (SCREEN - blockH) / 2;
  for (int i = 0; i < count; i++) {
    int16_t lineCenter = top + i * (lineH + gap) + lineH / 2;
    if (textWidthOf(lines[i], textSize) > chordWidthAt(lineCenter)) {
      return -1;
    }
  }
  return count;
}

void paintReply(const char *message) {
  tft.fillScreen(GC9A01A_BLACK);
  tft.setTextWrap(false);
  tft.setTextColor(GC9A01A_WHITE);

  char lines[MAX_REPLY_LINES][MAX_REPLY_CHARS];
  uint8_t textSize = 2;
  int count = wrapReply(message, textSize, 168, lines);
  if (count < 0) {
    textSize = 1;
    count = wrapReply(message, textSize, 180, lines);
  }
  if (count < 0) {
    tft.setTextSize(1);
    tft.setCursor(CENTER - 24, CENTER - 4);
    tft.print("...");
    return;
  }

  int16_t lineH = 8 * textSize;
  int16_t gap = 4;
  int16_t blockH = count * lineH + (count - 1) * gap;
  int16_t y = (SCREEN - blockH) / 2;
  tft.setTextSize(textSize);
  for (int i = 0; i < count; i++) {
    int16_t boundsX, boundsY;
    uint16_t boundsW, boundsH;
    tft.getTextBounds(lines[i], 0, 0, &boundsX, &boundsY, &boundsW, &boundsH);
    tft.setCursor((SCREEN - (int16_t)boundsW) / 2 - boundsX, y - boundsY);
    tft.print(lines[i]);
    y += lineH + gap;
  }
}

// ---------------------------------------------------------------------------
// State changes
// ---------------------------------------------------------------------------

void enterIdle() {
  state = STATE_IDLE;
  stateEnteredMs = millis();
  clockDrawn = false;
  drawnBatteryPercent = -1;
  tft.fillScreen(GC9A01A_BLACK);
  updateClock(true);
  sampleBattery();
  paintBattery(true);
  lastBatteryMs = millis();
  Serial.println("state: idle");
}

void enterListening() {
  state = STATE_LISTENING;
  stateEnteredMs = millis();
  lastWakeMs = stateEnteredMs;
  lastFrameMs = 0;
  wavePhase = 0.0f;
  tft.fillScreen(GC9A01A_BLACK);
  paintWave();
  Serial.println("state: listening");
}

void enterReply() {
  state = STATE_REPLY;
  stateEnteredMs = millis();
  strncpy(activeReply, pendingReply, sizeof(activeReply) - 1);
  activeReply[sizeof(activeReply) - 1] = '\0';
  paintReply(activeReply);
  Serial.print("state: reply \"");
  Serial.print(activeReply);
  Serial.println("\"");
}

void serviceRequests() {
  bool wake = false;
  bool reply = false;
  noInterrupts();
  if (wakeRequested) {
    wakeRequested = false;
    wake = true;
  }
  if (replyRequested) {
    replyRequested = false;
    reply = true;
  }
  interrupts();

  // A reply replaces listening. Wake is ignored if a reply arrived too.
  if (reply) {
    enterReply();
  } else if (wake) {
    enterListening();
  }
}

// Call this from loop() when the wake word scores. Do not call it from
// an interrupt. The waveform starts on the next pass through loop().
void onWakeWord() {
  wakeRequested = true;
}

// Call this from loop() when BLE delivers the spoken answer.
// The screen returns to the clock after 6 seconds.
void showReply(String text) {
  text.trim();
  char local[sizeof(pendingReply)];
  if (text.length() == 0) {
    strncpy(local, "...", sizeof(local));
  } else {
    text.toCharArray(local, sizeof(local));
  }
  noInterrupts();
  memcpy(pendingReply, local, sizeof(pendingReply));
  replyRequested = true;
  interrupts();
}

void maybeBenchWake() {
  if (!BENCH_TEST || state != STATE_IDLE) {
    return;
  }
  if (millis() - lastWakeMs >= BENCH_WAKE_EVERY_MS) {
    onWakeWord();
  }
}

// ---------------------------------------------------------------------------
// Arduino entry points
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("Nearby GC9A01 display");

  captureCompileTime();
  startBatterySense();

  tft.begin(SPI_HZ);
  tft.setRotation(DISPLAY_ROTATION);
  tft.invertDisplay(DISPLAY_INVERT);
  tft.setTextWrap(false);
  tft.fillScreen(GC9A01A_BLACK);

  if (waveCanvas.getBuffer() == nullptr) {
    Serial.println("Waveform canvas allocation failed");
  }

  lastWakeMs = millis();
  enterIdle();
}

void loop() {
  maybeBenchWake();
  serviceRequests();

  uint32_t now = millis();

  if (state == STATE_LISTENING) {
    if (lastFrameMs == 0 || now - lastFrameMs >= FRAME_MS) {
      lastFrameMs = now;
      wavePhase += 0.40f;
      if (wavePhase > 50.0f) {
        wavePhase -= 6.283185f;
      }
      paintWave();
    }
    if (BENCH_TEST && now - stateEnteredMs >= BENCH_LISTEN_MS) {
      showReply(BENCH_REPLY);
    } else if (!BENCH_TEST && now - stateEnteredMs >= LISTEN_GIVE_UP_MS) {
      enterIdle();
    }
  } else if (state == STATE_REPLY) {
    if (now - stateEnteredMs >= REPLY_HOLD_MS) {
      enterIdle();
    }
  } else {
    updateClock(false);
    if (now - lastBatteryMs >= BATTERY_PERIOD_MS) {
      sampleBattery();
      paintBattery(false);
      lastBatteryMs = now;
    }
  }

  serviceRequests();
}
