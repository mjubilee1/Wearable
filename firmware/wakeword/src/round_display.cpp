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
// bezel does not clip a word. The face is a quiet clock: cream type on
// black, stone gray for the date, and a clay red only for a low battery.
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
static constexpr uint32_t kDotMs = 420;
static constexpr uint32_t kIdleSleepMs = 20000;
static constexpr uint32_t kCriticalGlanceMs = 8000;

static constexpr int kMaxLines = 6;
static constexpr int kLineChars = 28;

static Adafruit_GC9A01A tft(kCs, kDc, kRst);
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
static int shownMode = -1;
static int shownFresh = -1;
static uint8_t dotStep = 0;
static uint32_t dotMs = 0;

static uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

static const uint16_t kCream = rgb565(244, 239, 230);
static const uint16_t kStone = rgb565(154, 148, 140);
static const uint16_t kAlert = rgb565(184, 84, 72);

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

static void paintDots(int16_t y) {
  const int16_t gap = 18;
  const int16_t radius = 3;
  tft.fillRect(kCenter - 36, y - 8, 72, 16, GC9A01A_BLACK);
  for (int i = 0; i < 3; ++i) {
    const int16_t x = kCenter - gap + (int16_t)(i * gap);
    if (i == (int)dotStep) tft.fillCircle(x, y, radius, kCream);
    else tft.fillCircle(x, y, radius, kStone);
  }
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

static const char *idleStatus(uint16_t *color) {
  if (criticalMode || batteryCritical()) {
    *color = kAlert;
    return "Charge the battery";
  }
  if (batteryLow()) {
    *color = kAlert;
    return "Low battery";
  }
  if (!phoneConnected) {
    *color = kStone;
    return "No phone";
  }
  *color = kStone;
  return "";
}

static void paintIdle(bool full) {
  if (full) {
    tft.fillScreen(GC9A01A_BLACK);
    shownTime[0] = '\0';
    shownDate[0] = '\0';
    shownMode = -1;
    shownFresh = -1;
  }

  const bool hasTime = clockHasTime();
  const int mode = hasTime ? 1 : 0;
  const bool modeChanged = shownMode != mode;
  if (full || modeChanged) {
    tft.fillRect(16, 56, 208, 140, GC9A01A_BLACK);
    shownTime[0] = '\0';
    shownDate[0] = '\0';
    shownMode = mode;
    shownFresh = -1;
  }

  if (!hasTime) {
    if (strcmp(shownTime, "--:--") != 0) {
      printCentered("--:--", 84, 5, kCream);
      printCentered("Open the Nearby app", 140, 1, kStone);
      strncpy(shownTime, "--:--", sizeof(shownTime) - 1);
    }
  } else {
    char hhmm[8];
    char date[20];
    bool isPm = false;
    clockWriteFace(hhmm, sizeof(hhmm), &isPm, date, sizeof(date));
    const int fresh = clockIsFresh() ? 1 : 0;
    if (strcmp(hhmm, shownTime) != 0 || isPm != shownPm || shownFresh != fresh) {
      tft.fillRect(16, 64, 208, 72, GC9A01A_BLACK);
      printCentered(hhmm, 68, 5, fresh ? kCream : kStone);
      printCentered(isPm ? "PM" : "AM", 118, 2, kStone);
      strncpy(shownTime, hhmm, sizeof(shownTime) - 1);
      shownTime[sizeof(shownTime) - 1] = '\0';
      shownPm = isPm;
      shownFresh = fresh;
    }
    if (strcmp(date, shownDate) != 0) {
      tft.fillRect(16, 146, 208, 22, GC9A01A_BLACK);
      printCentered(date, 150, 2, kStone);
      strncpy(shownDate, date, sizeof(shownDate) - 1);
      shownDate[sizeof(shownDate) - 1] = '\0';
    }
  }

  static char shownStatus[32] = "";
  uint16_t statusColor = kStone;
  const char *status = hasTime ? idleStatus(&statusColor) : "";
  if (full || modeChanged || strcmp(status, shownStatus) != 0) {
    tft.fillRect(16, 180, 208, 16, GC9A01A_BLACK);
    if (status[0] != '\0') printCentered(status, 184, 1, statusColor);
    strncpy(shownStatus, status, sizeof(shownStatus) - 1);
    shownStatus[sizeof(shownStatus) - 1] = '\0';
  }
}

static void paintListening(bool full) {
  if (full) {
    tft.fillScreen(GC9A01A_BLACK);
    const char *label = activity == PendantFace::Clip ? "Clip" : "Listening";
    printCentered(label, 88, 2, kCream);
    dotStep = 0;
  }
  paintDots(132);
}

static void paintThinking(bool full) {
  if (full) {
    tft.fillScreen(GC9A01A_BLACK);
    printCentered("One moment", 88, 2, kCream);
    dotStep = 0;
  }
  paintDots(132);
}

static void paintReply() {
  tft.fillScreen(GC9A01A_BLACK);
  paintWrapped(replyText, kCream, 88);
}

static void paintNotice() {
  tft.fillScreen(GC9A01A_BLACK);
  if (textWidth(noticeTitle, 2) <= chordWidthAt(78)) {
    printCentered(noticeTitle, 72, 2, kCream);
  } else {
    printCentered(noticeTitle, 72, 1, kCream);
  }
  paintWrapped(noticeBody, kStone, 108);
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
  printCentered("Goodbye", 108, 2, kCream);
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
  shownMode = -1;
  shownFresh = -1;
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
  Serial.println("[display] face ready");
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
  const bool animated = screen == WatchScreen::Listening ||
                        screen == WatchScreen::Thinking;
  if (!full && !animated && screen != WatchScreen::Idle) return;
  if (!full && animated && millis() - dotMs < kDotMs) return;
  if (!full && animated) dotStep = (uint8_t)((dotStep + 1) % 3);
  render(screen, full);
  painted = screen;
  paintFresh = true;
  if (animated) dotMs = millis();
}
