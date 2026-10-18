#pragma once

#include <stdbool.h>

// The XIAO reads the LiPo through an on-board divider. Call batteryBegin()
// once, then batteryPoll() from loop(). It samples every 30 seconds.

void batteryBegin();
void batteryPoll();

int batteryPercent();
bool batteryPresent();
// A real cell under 15%. USB-only boards with no cell stay false.
bool batteryLow();
// Latches on under 5% and releases at 8% so it does not flicker.
bool batteryCritical();
