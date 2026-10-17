#pragma once

#include <stddef.h>
#include <stdint.h>

// One held turn on the onboard QSPI flash. A new turn replaces it.
// Idle audio is never written here.

enum class CacheWrite : uint8_t { Ok, Full, Unavailable };

bool turnCacheBegin();
bool turnCacheAvailable();

// Replaces any clip already held.
void turnCacheStart(uint8_t source, uint8_t confidencePercent);
CacheWrite turnCacheAppend(const int16_t *samples, size_t count);
void turnCacheFinish();

bool turnCachePending();
uint32_t turnCacheBytes();
void turnCacheEvent(uint8_t event[2]);

// Copies the next unread bytes without advancing. consume moves the cursor.
size_t turnCachePeek(uint8_t *dest, size_t maxLen);
void turnCacheConsume(size_t length);
void turnCacheRewind();
void turnCacheClear();
