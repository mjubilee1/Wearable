#pragma once

#include <Arduino.h>
#include <stdint.h>

// What the microphone path is doing. The spoken-turn hooks below decide
// the picture. This only tells the face whether a clip is in progress.
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
void roundDisplayWatch();
void roundDisplaySetConnected(bool connected);

// True while the panel controller is in sleep. The backlight is wired to
// 3V3, so this saves the panel, not the LED.
bool roundDisplayAsleep();
// Button press while the glass is dark: show the clock, do not start a turn.
void roundDisplayGlance();
// Under 5% battery. The clock keeps running; the glass stays dark.
void roundDisplayForceSleep();
void roundDisplayPowerOk();

// Hooks for wake-word and BLE code. They only raise flags. loop() draws,
// so they are safe from a BLE callback.
//
//   onWakeWord()                 the word Listening, and three quiet dots
//   showThinking()               "One moment" while the reply is on the way
//   showReply(text)              wrapped text, back to the clock after 6 s
//   showNotice(title, body)      for example showNotice("Calendar", "Meeting in 10 min")
void onWakeWord();
void showThinking();
void showReply(String text);
void showNotice(const char *title, const char *body);

// Long-press sleep. Goodbye is painted now. Suspend blanks the controller.
// Resume paints the idle clock. The backlight stays on 3V3.
void roundDisplayShowGoodbye();
void roundDisplaySuspend();
void roundDisplayResume();
