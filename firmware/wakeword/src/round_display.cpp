#include "round_display.h"

#include <Adafruit_GC9A01A.h>
#include <Adafruit_GFX.h>
#include <SPI.h>
#include <math.h>
#include <string.h>

#include "battery.h"
#include "clock.h"
#include "config.h"

// 240x240 panel, round glass. Draw inside a radius of about 104 px so the
// bezel does not clip a word. The teal ring matches the old Nearby face.
//
// Redraw only the piece that changed. A full clear happens when the screen
// changes (clock -> listening, and so on), not on every frame.

static constexpr int8_t kCs = D1;
static constexpr int8_t kDc = D2;
static constexpr int8_t kRst = D3;
static constexpr uint8_t kMiso = D9;
static constexpr uint8_t kSck = D8;
static constexpr uint8_t kMosi = D10;
static constexpr uint32_t kSpiHz = 8000000;
static constexpr int16_t kScreen = 240;
static constexpr int16_t kCenter = 120;
static constexpr int16_t kSafeRadius = 104;

static constexpr uint32_t kReplyHoldMs = 6000;
static constexpr uint32_t kNoticeHoldMs = 8000;
static constexpr uint32_t kThinkingHoldMs = 20000;
static constexpr uint32_t kListenGiveUpMs = 8000;
static constexpr uint32_t kFrameMs = 50;
static constexpr uint32_t kIdleSleepMs = 20000;
static constexpr uint32_t kCriticalGlanceMs = 8000;

static constexpr int kMaxLines = 6;
static constexpr int kLineChars = 28;

static Adafruit_GC9A01A tft(kCs, kDc, kRst);
static GFXcanvas16 sprite(160, 64);
static bool ready = false;
static bool panelAsleep = false;
static bool wakeRequested = false;
static bool criticalMode = false;
static bool sleepLogged = false;
static uint32_t lastActivityMs = 0;

enum class WatchScreen : uint8_t {
  Idle = 0,
  Listening,
  Thinking,
  Reply,
  Notice,
};

static PendantFace activity = PendantFace::Idle;
static WatchScreen painted = WatchScreen::Idle;
static bool paintFresh = false;

static bool listenHook = false;
static uint32_t listenStartMs = 0;
static bool thinkingHook = false;
static uint32_t thinkingStartMs = 0;
static bool replyActive = false;
static uint32_t replyStartMs = 0;
static bool noticeActive = false;
static uint32_t noticeStartMs = 0;

static char replyText[97];
static char noticeTitle[33];
static char noticeBody[97];

static bool phoneConnected = false;
static char shownTime[8] = "";
static char shownDate[20] = "";
static bool shownPm = false;
static int shownBattery = -2;
static int shownLink = -1;
static int shownMode = -1;
static int shownDot = -1;

static float wavePhase = 0.0f;
static float arcAngle = 0.0f;

static uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

static const uint16_t kTeal = rgb565(13, 148, 136);
static const uint16_t kTealBright = rgb565(45, 212, 191);
static const uint16_t kDim = rgb565(150, 164, 166);
static const uint16_t kRed = rgb565(255, 72, 72);

static void copyText(char *dest, size_t destLen, const char *src) {
  if (src == nullptr) src = "";
  strncpy(dest, src, destLen - 1);
  dest[destLen - 1] = '\0';
}

static void noteActivity() {
  lastActivityMs = millis();
  wakeRequested = true;
  sleepLogged = false;
}

static void panelSleep() {
  if (!ready || panelAsleep) return;
  tft.sendCommand(GC9A01A_DISPOFF);
  tft.sendCommand(GC9A01A_SLPIN);
  panelAsleep = true;
  paintFresh = false;
  if (!sleepLogged) {
    sleepLogged = true;
    Serial.println("[display] screen off; button, wake word, or phone wakes it");
  }
}

static void panelWakeNow() {
  if (!ready || !panelAsleep) return;
  tft.sendCommand(GC9A01A_SLPOUT);
  delay(120);
  tft.sendCommand(GC9A01A_DISPON);
  tft.invertDisplay(true);
  panelAsleep = false;
  paintFresh = false;
  Serial.println("[display] screen on");
}

static void printCentered(const char *text, int16_t top, uint8_t size,
                          uint16_t color) {
  tft.setTextWrap(false);
  tft.setTextSize(size);
  tft.setTextColor(color);
  int16_t boundsX = 0;
  int16_t boundsY = 0;
  uint16_t boundsW = 0;
  uint16_t boundsH = 0;
  tft.getTextBounds(text, 0, 0, &boundsX, &boundsY, &boundsW, &boundsH);
  tft.setCursor((kScreen - (int16_t)boundsW) / 2 - boundsX, top - boundsY);
  tft.print(text);
}

static int16_t textWidth(const char *text, uint8_t size) {
  tft.setTextSize(size);
  int16_t boundsX = 0;
  int16_t boundsY = 0;
  uint16_t boundsW = 0;
  uint16_t boundsH = 0;
  tft.getTextBounds(text, 0, 0, &boundsX, &boundsY, &boundsW, &boundsH);
  return (int16_t)boundsW;
}

// Width of the circle at this row, minus a small margin.
static int16_t chordWidthAt(int16_t screenY) {
  const int32_t dy = screenY - kCenter;
  const int32_t remaining =
      (int32_t)kSafeRadius * kSafeRadius - dy * dy;
  if (remaining <= 0) return 0;
  return (int16_t)(sqrtf((float)remaining) * 2.0f) - 10;
}

static void drawRing(uint16_t color) {
  tft.drawCircle(kCenter, kCenter, 116, color);
  tft.drawCircle(kCenter, kCenter, 114, color);
  tft.drawCircle(kCenter, kCenter, 112, color);
}

static void drawBluetooth(bool connected) {
  const int16_t x = kCenter;
  const int16_t y = 32;
  tft.fillRect(x - 12, y - 14, 24, 28, GC9A01A_BLACK);
  const uint16_t color = connected ? kTealBright : kDim;
  tft.drawLine(x, y - 11, x, y + 11, color);
  tft.drawLine(x, y - 11, x + 7, y - 4, color);
  tft.drawLine(x + 7, y - 4, x - 6, y + 5, color);
  tft.drawLine(x - 6, y - 5, x + 7, y + 4, color);
  tft.drawLine(x + 7, y + 4, x, y + 11, color);
  if (connected) tft.fillCircle(x, y, 2, color);
}

static void drawBatteryIcon() {
  const int16_t slotX = 46;
  const int16_t slotY = 188;
  tft.fillRect(slotX, slotY, 148, 24, GC9A01A_BLACK);

  char label[8];
  snprintf(label, sizeof(label), "%d%%", batteryPercent());
  tft.setTextSize(2);
  tft.setTextWrap(false);
  int16_t boundsX = 0;
  int16_t boundsY = 0;
  uint16_t boundsW = 0;
  uint16_t boundsH = 0;
  tft.getTextBounds(label, 0, 0, &boundsX, &boundsY, &boundsW, &boundsH);

  const bool warn = batteryLow();
  const int16_t bodyW = 26;
  const int16_t bodyH = 14;
  const int16_t nubW = 3;
  const int16_t gap = 6;
  const int16_t badge = warn ? 16 : 0;
  const int16_t groupW = badge + bodyW + nubW + gap + (int16_t)boundsW;
  const int16_t groupX = (kScreen - groupW) / 2;
  const int16_t bodyY = slotY + (24 - bodyH) / 2;
  const uint16_t color = warn ? kRed : GC9A01A_WHITE;

  if (warn) {
    const int16_t bx = groupX;
    const int16_t by = bodyY;
    tft.fillTriangle(bx + 6, by, bx, by + 13, bx + 12, by + 13, color);
    tft.drawFastVLine(bx + 6, by + 4, 5, GC9A01A_BLACK);
    tft.drawPixel(bx + 6, by + 11, GC9A01A_BLACK);
  }

  const int16_t bodyX = groupX + badge;
  tft.drawRoundRect(bodyX, bodyY, bodyW, bodyH, 2, color);
  tft.fillRect(bodyX + bodyW, bodyY + (bodyH - 6) / 2, nubW, 6, color);
  const int16_t fillW = (int16_t)(((bodyW - 4) * batteryPercent()) / 100);
  if (fillW > 0) tft.fillRect(bodyX + 2, bodyY + 2, fillW, bodyH - 4, color);

  tft.setTextColor(color);
  tft.setCursor(bodyX + bodyW + nubW + gap - boundsX,
                bodyY + (bodyH - (int16_t)boundsH) / 2 - boundsY);
  tft.print(label);
}

static int wrapLines(const char *message, uint8_t textSize, char lines[][kLineChars],
                     int maxLines) {
  int count = 0;
  const char *cursor = message == nullptr ? "" : message;
  while (*cursor != '\0' && count < maxLines) {
    while (*cursor == ' ') ++cursor;
    if (*cursor == '\0') break;

    char built[kLineChars];
    built[0] = '\0';
    bool fitted = false;
    const char *lineEnd = cursor;
    while (*cursor != '\0') {
      while (*cursor == ' ') ++cursor;
      if (*cursor == '\0') break;
      const char *wordEnd = cursor;
      while (*wordEnd != '\0' && *wordEnd != ' ') ++wordEnd;
      const int wordLen = (int)(wordEnd - cursor);
      char trial[kLineChars];
      const int builtLen = (int)strlen(built);
      if (builtLen + (builtLen > 0 ? 1 : 0) + wordLen >= kLineChars) break;
      if (builtLen > 0) {
        snprintf(trial, sizeof(trial), "%s %.*s", built, wordLen, cursor);
      } else {
        snprintf(trial, sizeof(trial), "%.*s", wordLen, cursor);
      }
      const int16_t lineCenter = 96 + count * (8 * textSize + 4);
      const int16_t limit = chordWidthAt(lineCenter);
      if (textWidth(trial, textSize) <= limit) {
        strncpy(built, trial, sizeof(built) - 1);
        built[sizeof(built) - 1] = '\0';
        lineEnd = wordEnd;
        cursor = wordEnd;
        fitted = true;
        continue;
      }
      if (!fitted) {
        int keep = wordLen;
        while (keep > 1 && textWidth(trial, textSize) > limit) {
          --keep;
          snprintf(trial, sizeof(trial), "%.*s", keep, cursor);
        }
        if (textWidth(trial, textSize) > limit) return -1;
        strncpy(built, trial, sizeof(built) - 1);
        built[sizeof(built) - 1] = '\0';
        lineEnd = cursor + keep;
        fitted = true;
      }
      break;
    }
    if (!fitted) return -1;
    strncpy(lines[count], built, kLineChars - 1);
    lines[count][kLineChars - 1] = '\0';
    ++count;
    cursor = lineEnd;
  }
  return count > 0 ? count : -1;
}

static void paintLines(char lines[][kLineChars], int count, uint8_t textSize,
                       uint16_t color, int16_t top) {
  int16_t y = top;
  for (int i = 0; i < count; ++i) {
    if (textWidth(lines[i], textSize) > chordWidthAt(y + textSize * 4)) return;
    printCentered(lines[i], y, textSize, color);
    y += textSize * 8 + 4;
  }
}

static bool paintWrapped(const char *message, uint16_t color, int16_t top) {
  char lines[kMaxLines][kLineChars];
  int count = wrapLines(message, 2, lines, kMaxLines);
  uint8_t size = 2;
  if (count < 0) {
    size = 1;
    count = wrapLines(message, 1, lines, kMaxLines);
  }
  if (count < 0) {
    printCentered("...", top, 2, color);
    return false;
  }
  paintLines(lines, count, size, color, top);
  return true;
}

static void paintSprite(int16_t x, int16_t y) {
  uint16_t *pixels = sprite.getBuffer();
  if (pixels == nullptr) return;
  tft.drawRGBBitmap(x, y, pixels, 160, 64);
}

static void paintWave() {
  if (sprite.getBuffer() == nullptr) return;
  sprite.fillScreen(0);
  const int bars = 15;
  const int gap = 4;
  const int barW = 6;
  const int used = bars * barW + (bars - 1) * gap;
  const int origin = (160 - used) / 2;
  for (int i = 0; i < bars; ++i) {
    const float swell = 0.5f + 0.5f * sinf(wavePhase + i * 0.48f);
    const float ripple = 0.5f + 0.5f * sinf(wavePhase * 1.7f + i * 0.85f);
    const float level = swell * 0.72f + ripple * 0.28f;
    int barH = 8 + (int)(level * 50);
    if (barH > 60) barH = 60;
    const int x = origin + i * (barW + gap);
    const int y = (64 - barH) / 2;
    sprite.fillRect(x, y, barW, barH, kTeal);
    if (barH > 8) sprite.fillRect(x + 1, y + 2, barW - 2, barH - 4, kTealBright);
  }
  paintSprite(40, 96);
}

static void paintArc() {
  if (sprite.getBuffer() == nullptr) return;
  sprite.fillScreen(0);
  const int cx = 80;
  const int cy = 32;
  const int radius = 22;
  const int steps = 16;
  float previous = arcAngle;
  int x0 = cx + (int)(cosf(previous) * radius);
  int y0 = cy + (int)(sinf(previous) * radius);
  for (int i = 1; i <= steps; ++i) {
    const float angle = arcAngle + 1.4f * ((float)i / (float)steps);
    const int x1 = cx + (int)(cosf(angle) * radius);
    const int y1 = cy + (int)(sinf(angle) * radius);
    sprite.drawLine(x0, y0, x1, y1, kTealBright);
    sprite.drawLine(x0, y0 + 1, x1, y1 + 1, kTeal);
    x0 = x1;
    y0 = y1;
  }
  paintSprite(40, 100);
}

static const char *idleHint() {
  if (criticalMode || batteryCritical()) return "Charge the battery";
  if (batteryLow()) return "Low battery";
  return "Say 'Hello Nearby'";
}

static void paintIdle(bool full) {
  if (full) {
    tft.fillScreen(GC9A01A_BLACK);
    drawRing(kTeal);
    shownTime[0] = '\0';
    shownDate[0] = '\0';
    shownBattery = -2;
    shownLink = -1;
    shownMode = -1;
    shownDot = -1;
  }

  if (shownLink != (phoneConnected ? 1 : 0)) {
    drawBluetooth(phoneConnected);
    shownLink = phoneConnected ? 1 : 0;
  }

  const bool hasTime = clockHasTime();
  const int mode = hasTime ? 1 : 0;
  const bool modeChanged = shownMode != mode;
  if (full || modeChanged) {
    tft.fillRect(28, 58, 184, 124, GC9A01A_BLACK);
    shownTime[0] = '\0';
    shownDate[0] = '\0';
    shownMode = mode;
    shownDot = -1;
  }

  if (!hasTime) {
    if (strcmp(shownTime, "--:--") != 0) {
      printCentered("--:--", 78, 6, GC9A01A_WHITE);
      printCentered("Open Nearby app to sync", 140, 1, kDim);
      strncpy(shownTime, "--:--", sizeof(shownTime) - 1);
    }
  } else {
    char hhmm[8];
    char date[20];
    bool isPm = false;
    clockWriteFace(hhmm, sizeof(hhmm), &isPm, date, sizeof(date));
    if (strcmp(hhmm, shownTime) != 0 || isPm != shownPm) {
      tft.fillRect(28, 62, 184, 70, GC9A01A_BLACK);
      printCentered(hhmm, 66, 6, GC9A01A_WHITE);
      printCentered(isPm ? "PM" : "AM", 118, 2, kDim);
      strncpy(shownTime, hhmm, sizeof(shownTime) - 1);
      shownTime[sizeof(shownTime) - 1] = '\0';
      shownPm = isPm;
      shownDot = -1;
    }
    const int dot = clockIsFresh() ? 0 : 1;
    if (shownDot != dot) {
      tft.fillCircle(168, 122, 4, dot ? kTealBright : GC9A01A_BLACK);
      shownDot = dot;
    }
    if (strcmp(date, shownDate) != 0) {
      tft.fillRect(24, 136, 192, 20, GC9A01A_BLACK);
      printCentered(date, 140, 2, GC9A01A_WHITE);
      strncpy(shownDate, date, sizeof(shownDate) - 1);
      shownDate[sizeof(shownDate) - 1] = '\0';
    }
  }

  const uint16_t hintColor = (batteryLow() || criticalMode) ? kRed : kDim;
  static char shownHint[32] = "";
  const char *hint = idleHint();
  if (full || modeChanged || strcmp(hint, shownHint) != 0) {
    tft.fillRect(28, 160, 184, 16, GC9A01A_BLACK);
    printCentered(hint, 164, 1, hintColor);
    strncpy(shownHint, hint, sizeof(shownHint) - 1);
    shownHint[sizeof(shownHint) - 1] = '\0';
  }

  if (shownBattery != batteryPercent() || full) {
    drawBatteryIcon();
    shownBattery = batteryPercent();
  }
}

static void paintListening(bool full) {
  if (full) {
    tft.fillScreen(GC9A01A_BLACK);
    const char *label = activity == PendantFace::Clip ? "Clip" : "Listening";
    printCentered(label, 48, 2, kTealBright);
    wavePhase = 0.0f;
  }
  const float pulse = 0.35f + 0.65f * (0.5f + 0.5f * sinf(wavePhase));
  const uint8_t scale = (uint8_t)(pulse * 255.0f);
  drawRing(rgb565((uint8_t)(13 * scale / 255), (uint8_t)(148 * scale / 255),
                  (uint8_t)(136 * scale / 255)));
  paintWave();
}

static void paintThinking(bool full) {
  if (full) {
    tft.fillScreen(GC9A01A_BLACK);
    drawRing(kTeal);
    printCentered("Thinking", 64, 2, GC9A01A_WHITE);
    arcAngle = 0.0f;
  }
  paintArc();
}

static void paintReply() {
  tft.fillScreen(GC9A01A_BLACK);
  drawRing(kTeal);
  paintWrapped(replyText, GC9A01A_WHITE, 78);
}

static void paintNotice() {
  tft.fillScreen(GC9A01A_BLACK);
  drawRing(kTeal);
  if (textWidth(noticeTitle, 2) <= chordWidthAt(70)) {
    printCentered(noticeTitle, 64, 2, kTealBright);
  } else {
    printCentered(noticeTitle, 64, 1, kTealBright);
  }
  paintWrapped(noticeBody, GC9A01A_WHITE, 100);
}

static WatchScreen currentScreen() {
  const uint32_t now = millis();
  if (replyActive && now - replyStartMs >= kReplyHoldMs) replyActive = false;
  if (noticeActive && now - noticeStartMs >= kNoticeHoldMs) noticeActive = false;
  if (thinkingHook && now - thinkingStartMs >= kThinkingHoldMs) thinkingHook = false;
  const bool live = activity == PendantFace::Listening ||
                    activity == PendantFace::Holding ||
                    activity == PendantFace::Clip;
  if (listenHook && !live && now - listenStartMs >= kListenGiveUpMs) {
    listenHook = false;
  }

  if (replyActive) return WatchScreen::Reply;
  if (noticeActive) return WatchScreen::Notice;
  if (listenHook) return WatchScreen::Listening;
  if (thinkingHook) return WatchScreen::Thinking;
  return WatchScreen::Idle;
}

static void render(WatchScreen screen, bool full) {
  switch (screen) {
    case WatchScreen::Listening:
      paintListening(full);
      break;
    case WatchScreen::Thinking:
      paintThinking(full);
      break;
    case WatchScreen::Reply:
      if (full) paintReply();
      break;
    case WatchScreen::Notice:
      if (full) paintNotice();
      break;
    case WatchScreen::Idle:
    default:
      paintIdle(full);
      break;
  }
}

void roundDisplaySetConnected(bool connected) {
  if (connected && !phoneConnected) noteActivity();
  phoneConnected = connected;
}

bool roundDisplayAsleep() { return panelAsleep; }

void roundDisplayGlance() { noteActivity(); }

void roundDisplayForceSleep() {
  criticalMode = true;
  panelSleep();
}

void roundDisplayPowerOk() { criticalMode = false; }

void onWakeWord() {
  listenHook = true;
  listenStartMs = millis();
  thinkingHook = false;
  replyActive = false;
  noticeActive = false;
  noteActivity();
}

void showThinking() {
  thinkingHook = true;
  thinkingStartMs = millis();
  listenHook = false;
  replyActive = false;
  noticeActive = false;
  noteActivity();
}

void showReply(String text) {
  text.trim();
  char local[sizeof(replyText)];
  if (text.length() == 0) {
    strncpy(local, "...", sizeof(local));
  } else {
    text.toCharArray(local, sizeof(local));
  }
  noInterrupts();
  memcpy(replyText, local, sizeof(replyText));
  replyActive = true;
  replyStartMs = millis();
  thinkingHook = false;
  listenHook = false;
  noticeActive = false;
  interrupts();
  noteActivity();
  paintFresh = false;
}

void showNotice(const char *title, const char *body) {
  char titleLocal[sizeof(noticeTitle)];
  char bodyLocal[sizeof(noticeBody)];
  copyText(titleLocal, sizeof(titleLocal), title);
  copyText(bodyLocal, sizeof(bodyLocal), body);
  noInterrupts();
  memcpy(noticeTitle, titleLocal, sizeof(noticeTitle));
  memcpy(noticeBody, bodyLocal, sizeof(noticeBody));
  noticeActive = true;
  noticeStartMs = millis();
  thinkingHook = false;
  listenHook = false;
  replyActive = false;
  interrupts();
  noteActivity();
  paintFresh = false;
}

void roundDisplayShowGoodbye() {
  if (!ready) return;
  if (panelAsleep) panelWakeNow();
  listenHook = false;
  thinkingHook = false;
  replyActive = false;
  noticeActive = false;
  tft.fillScreen(GC9A01A_BLACK);
  drawRing(kTeal);
  printCentered("Goodbye", 108, 3, GC9A01A_WHITE);
  Serial.println("[display] goodbye");
}

void roundDisplaySuspend() {
  if (!ready) return;
  if (!panelAsleep) {
    tft.sendCommand(GC9A01A_DISPOFF);
    delay(20);
    tft.sendCommand(GC9A01A_SLPIN);
    delay(120);
    panelAsleep = true;
    paintFresh = false;
  }
  Serial.println("[display] off");
}

void roundDisplayResume() {
  if (!ready) return;
  listenHook = false;
  thinkingHook = false;
  replyActive = false;
  noticeActive = false;
  activity = PendantFace::Idle;
  shownTime[0] = '\0';
  shownDate[0] = '\0';
  shownBattery = -2;
  shownLink = -1;
  shownMode = -1;
  shownDot = -1;
  if (panelAsleep) panelWakeNow();
  noteActivity();
  painted = WatchScreen::Idle;
  paintFresh = false;
  render(WatchScreen::Idle, true);
  paintFresh = true;
  Serial.println("[display] on");
}

void roundDisplayBegin() {
  Serial.println("[display] SCK=D8 MOSI=D10 CS=D1 DC=D2 RST=D3");
  SPI.setPins(kMiso, kSck, kMosi);
  pinMode(kRst, OUTPUT);
  digitalWrite(kRst, LOW);
  delay(20);
  digitalWrite(kRst, HIGH);
  delay(120);
  tft.begin(kSpiHz);
  tft.setRotation(0);
  tft.invertDisplay(true);
  tft.setTextWrap(false);
  ready = true;
  clockBegin();
  batteryBegin();
  lastActivityMs = millis();
  painted = WatchScreen::Idle;
  paintFresh = false;
  render(WatchScreen::Idle, true);
  paintFresh = true;
  Serial.println("[display] watch face ready");
}

bool roundDisplayReady() { return ready; }

void roundDisplayShow(PendantFace face) {
  if (face == PendantFace::Clip && activity != PendantFace::Clip) {
    listenHook = true;
    listenStartMs = millis();
    noteActivity();
  }
  activity = face;
}

void roundDisplayWatch() {
  if (!ready) return;
  const bool wasFresh = clockIsFresh();
  clockPoll();
  batteryPoll();
  if (clockIsFresh() && !wasFresh) noteActivity();

  if (wakeRequested) {
    wakeRequested = false;
    panelWakeNow();
  }
  if (panelAsleep) return;

  if (criticalMode && millis() - lastActivityMs >= kCriticalGlanceMs &&
      currentScreen() == WatchScreen::Idle) {
    panelSleep();
    return;
  }

  const WatchScreen screen = currentScreen();
  if (!criticalMode && screen == WatchScreen::Idle &&
      millis() - lastActivityMs >= kIdleSleepMs) {
    panelSleep();
    return;
  }

  const bool full = !paintFresh || screen != painted;
  if (!full && screen != WatchScreen::Listening &&
      screen != WatchScreen::Thinking && screen != WatchScreen::Idle) {
    return;
  }
  if (!full && (screen == WatchScreen::Listening ||
                screen == WatchScreen::Thinking)) {
    static uint32_t lastFrameMs = 0;
    if (millis() - lastFrameMs < kFrameMs) return;
    lastFrameMs = millis();
  }
  render(screen, full);
  painted = screen;
  paintFresh = true;
  if (screen == WatchScreen::Listening) wavePhase += 0.45f;
  if (screen == WatchScreen::Thinking) {
    arcAngle += 0.45f;
    if (arcAngle > 6.283185f) arcAngle -= 6.283185f;
  }
}
