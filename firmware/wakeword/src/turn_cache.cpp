#include "turn_cache.h"

#include <Arduino.h>
#include <Adafruit_SPIFlash.h>

#include "config.h"

// Onboard 2 MB P25Q16H. Sector 0 is the header. Audio starts at the next sector.
// This is one clip, overwritten by the next trigger and erased after delivery.

static constexpr uint32_t kMagic = 0x314E4259;  // 'YBN1'
static constexpr uint32_t kSectorSize = 4096;
static constexpr uint32_t kAudioBase = kSectorSize;
static constexpr uint8_t kStateEmpty = 0;
static constexpr uint8_t kStateWriting = 1;
static constexpr uint8_t kStateReady = 2;

struct __attribute__((packed)) CacheHeader {
  uint32_t magic;
  uint32_t pcmBytes;
  uint8_t source;
  uint8_t confidencePercent;
  uint8_t state;
  uint8_t reserved;
};

static Adafruit_FlashTransport_QSPI flashTransport;
static Adafruit_SPIFlash flash(&flashTransport);

static bool flashReady = false;
static bool pending = false;
static bool writing = false;
static uint32_t maxAudioBytes = 0;
static uint32_t writeEnd = 0;
static uint32_t erasedThrough = 0;
static uint32_t readOffset = 0;
static uint8_t heldSource = 0;
static uint8_t heldConfidence = 0;

static uint32_t captureLimitBytes() {
  return static_cast<uint32_t>(kSampleRateHz) * sizeof(int16_t) *
         (NEARBY_MAX_CAPTURE_MS / 1000);
}

static bool readHeader(CacheHeader *header) {
  return flash.readBuffer(0, reinterpret_cast<uint8_t *>(header),
                          sizeof(*header)) == sizeof(*header);
}

static bool writeHeader(const CacheHeader &header) {
  if (!flash.eraseSector(0)) return false;
  return flash.writeBuffer(0, reinterpret_cast<const uint8_t *>(&header),
                           sizeof(header)) == sizeof(header);
}

bool turnCacheBegin() {
  flashReady = false;
  pending = false;
  if (!flash.begin()) {
    Serial.println("[cache] onboard flash did not start; a turn with no phone is dropped");
    return false;
  }

  const uint32_t capacity =
      flash.size() > kAudioBase ? flash.size() - kAudioBase : 0;
  maxAudioBytes = min(capacity, captureLimitBytes());
  if (maxAudioBytes < sizeof(int16_t)) {
    Serial.println("[cache] onboard flash is too small");
    return false;
  }

  flashReady = true;
  CacheHeader header{};
  if (!readHeader(&header) || header.magic != kMagic ||
      header.state != kStateReady || header.pcmBytes == 0 ||
      header.pcmBytes > maxAudioBytes) {
    Serial.printf("[cache] onboard flash ready, holding up to %lu bytes\n",
                  static_cast<unsigned long>(maxAudioBytes));
    return true;
  }

  pending = true;
  heldSource = header.source;
  heldConfidence = header.confidencePercent;
  writeEnd = header.pcmBytes;
  readOffset = 0;
  Serial.printf("[cache] found a held turn, %lu bytes\n",
                static_cast<unsigned long>(header.pcmBytes));
  return true;
}

bool turnCacheAvailable() { return flashReady; }

void turnCacheStart(uint8_t source, uint8_t confidencePercent) {
  writing = false;
  pending = false;
  writeEnd = 0;
  erasedThrough = 0;
  readOffset = 0;
  heldSource = source;
  heldConfidence = confidencePercent;
  if (!flashReady) return;

  CacheHeader header{kMagic, 0, source, confidencePercent, kStateWriting, 0};
  if (!writeHeader(header)) {
    Serial.println("[cache] could not open a held turn");
    return;
  }
  writing = true;
}

CacheWrite turnCacheAppend(const int16_t *samples, size_t count) {
  if (!flashReady || !writing || samples == nullptr || count == 0) {
    return CacheWrite::Unavailable;
  }

  const uint32_t nbytes = static_cast<uint32_t>(count * sizeof(int16_t));
  if (writeEnd + nbytes > maxAudioBytes) return CacheWrite::Full;

  while (erasedThrough < writeEnd + nbytes) {
    const uint32_t sector = (kAudioBase + erasedThrough) / kSectorSize;
    if (!flash.eraseSector(sector)) return CacheWrite::Unavailable;
    erasedThrough += kSectorSize;
  }

  const uint32_t wrote = flash.writeBuffer(
      kAudioBase + writeEnd, reinterpret_cast<const uint8_t *>(samples), nbytes);
  if (wrote != nbytes) return CacheWrite::Unavailable;
  writeEnd += nbytes;
  return CacheWrite::Ok;
}

void turnCacheFinish() {
  if (!writing) return;
  writing = false;
  if (!flashReady || writeEnd == 0) {
    turnCacheClear();
    return;
  }

  CacheHeader header{kMagic, writeEnd, heldSource, heldConfidence, kStateReady, 0};
  if (!writeHeader(header)) {
    Serial.println("[cache] could not seal the held turn");
    pending = false;
    return;
  }
  pending = true;
  readOffset = 0;
  Serial.printf("[cache] holding %lu bytes until the phone is back\n",
                static_cast<unsigned long>(writeEnd));
}

bool turnCachePending() { return pending && !writing; }

uint32_t turnCacheBytes() { return pending ? writeEnd : 0; }

void turnCacheEvent(uint8_t event[2]) {
  event[0] = heldSource;
  event[1] = heldConfidence;
}

size_t turnCachePeek(uint8_t *dest, size_t maxLen) {
  if (!pending || dest == nullptr || maxLen == 0 || readOffset >= writeEnd) {
    return 0;
  }
  const uint32_t remaining = writeEnd - readOffset;
  const uint32_t nbytes = min(static_cast<uint32_t>(maxLen), remaining);
  const uint32_t got =
      flash.readBuffer(kAudioBase + readOffset, dest, nbytes);
  return got;
}

void turnCacheConsume(size_t length) {
  if (!pending) return;
  readOffset = min(writeEnd, readOffset + static_cast<uint32_t>(length));
}

void turnCacheRewind() { readOffset = 0; }

void turnCacheClear() {
  pending = false;
  writing = false;
  writeEnd = 0;
  readOffset = 0;
  erasedThrough = 0;
  if (!flashReady) return;
  flash.eraseSector(0);
}
