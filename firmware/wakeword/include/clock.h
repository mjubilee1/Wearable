#pragma once

#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>

// The clock lives on RTC2, which counts the 32.768 kHz crystal.
// millis() follows the FreeRTOS tick. That tick pauses if the scheduler
// pauses. RTC2 keeps counting while the CPU is asleep.
//
// A full power-off still resets RTC2. The last checkpoint in internal
// flash covers that gap until the phone writes the time again.

void clockBegin();
void clockAddService();
void clockPoll();
void clockSaveNow();

// True after any phone sync, including one restored from flash.
bool clockHasTime();
// True only after a phone write during this boot. The face draws a dot
// until this becomes true.
bool clockIsFresh();
// Local civil seconds (UTC + the phone's offset). Valid when clockHasTime().
int32_t clockLocalUnix();
// Fills "H:MM", AM/PM, and "Sat, Oct 17". No-op when the clock has no time.
void clockWriteFace(char *hhmm, size_t hhmmLen, bool *isPm, char *date,
                    size_t dateLen);
