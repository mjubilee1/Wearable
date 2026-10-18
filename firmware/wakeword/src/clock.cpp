#include "clock.h"

#include <Arduino.h>
#include <InternalFileSystem.h>
#include <bluefruit.h>
#include <string.h>

#include "config.h"

// RTC2 is free. The SoftDevice owns RTC0. FreeRTOS owns RTC1 (that is
// millis()). The 24-bit counter rolls over every 512 seconds, so the
// overflow interrupt extends it.
static constexpr uint32_t kRtcHz = 32768;
static constexpr uint32_t kOverflowTicks = 1UL << 24;
static constexpr uint32_t kSaveEveryMs = 180000;
static constexpr int32_t kMinUnix = 1577836800;  // 2020-01-01 UTC
static constexpr int32_t kMaxOffset = 18 * 3600;
static constexpr uint32_t kCheckpointMagic = 0x31454D54;  // 'TME1'

struct __attribute__((packed)) Checkpoint {
  uint32_t magic;
  int32_t unixUtc;
  int32_t offsetSeconds;
  uint8_t everSynced;
  uint8_t reserved[3];
  uint32_t crc;
};

struct __attribute__((packed)) CurrentTimeBytes {
  uint16_t year;
  uint8_t month;
  uint8_t day;
  uint8_t hours;
  uint8_t minutes;
  uint8_t seconds;
  uint8_t weekday;
  uint8_t fractions;
  uint8_t adjustReason;
};

struct __attribute__((packed)) LocalTimeBytes {
  int8_t timezoneQuarters;
  uint8_t dstOffset;
};

static volatile uint32_t rtcOverflows = 0;
static bool rtcReady = false;
static bool storageReady = false;
static bool everSynced = false;
static bool freshThisBoot = false;
static int32_t baseUtc = 0;
static int32_t offsetSeconds = 0;
static uint64_t baseTicks = 0;
static uint32_t lastSaveMs = 0;

static volatile bool customPending = false;
static TimeSync pendingCustom = {};
static volatile bool currentTimePending = false;
static CurrentTimeBytes pendingCurrent = {};
static volatile bool localTimePending = false;
static LocalTimeBytes pendingLocal = {};

static BLEService timeService(kTimeServiceUuid);
static BLECharacteristic timeCharacteristic(kTimeCharacteristicUuid);
static BLEService ctsService(0x1805);
static BLECharacteristic currentTimeChar(0x2A2B);
static BLECharacteristic localTimeChar(0x2A0F);

extern "C" void RTC2_IRQHandler(void) {
  if (NRF_RTC2->EVENTS_OVRFLW) {
    NRF_RTC2->EVENTS_OVRFLW = 0;
    rtcOverflows++;
  }
}

static uint32_t checksum(const Checkpoint &record) {
  uint32_t crc = 0xA5A5A5A5;
  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(&record);
  const size_t length = sizeof(record) - sizeof(record.crc);
  for (size_t i = 0; i < length; ++i) {
    crc = (crc << 5) ^ (crc >> 3) ^ bytes[i];
  }
  return crc;
}

static uint64_t rtcTicks() {
  for (;;) {
    const uint32_t high = rtcOverflows;
    const uint32_t low = NRF_RTC2->COUNTER & 0xFFFFFF;
    const bool wrapped = NRF_RTC2->EVENTS_OVRFLW && low < 0x800000;
    if (high != rtcOverflows) continue;
    return (static_cast<uint64_t>(high + (wrapped ? 1 : 0)) << 24) | low;
  }
}

static void startRtc() {
  NRF_RTC2->TASKS_STOP = 1;
  NRF_RTC2->TASKS_CLEAR = 1;
  NRF_RTC2->PRESCALER = 0;
  NRF_RTC2->EVENTS_OVRFLW = 0;
  NRF_RTC2->EVTENSET = RTC_EVTENSET_OVRFLW_Msk;
  NRF_RTC2->INTENSET = RTC_INTENSET_OVRFLW_Msk;
  rtcOverflows = 0;
  NVIC_SetPriority(RTC2_IRQn, 6);
  NVIC_ClearPendingIRQ(RTC2_IRQn);
  NVIC_EnableIRQ(RTC2_IRQn);
  NRF_RTC2->TASKS_START = 1;
  rtcReady = true;
  baseTicks = 0;

  const bool running =
      (NRF_CLOCK->LFCLKSTAT & CLOCK_LFCLKSTAT_STATE_Msk) != 0;
  Serial.printf("[clock] RTC2 started on the 32.768 kHz clock (%s)\n",
                running ? "running" : "waiting for LFCLK");
}

static int32_t utcNow() {
  if (!rtcReady) return baseUtc;
  const uint64_t elapsed = rtcTicks() - baseTicks;
  return baseUtc + static_cast<int32_t>(elapsed / kRtcHz);
}

static void remember(int32_t unixUtc, int32_t offset, bool fromPhone) {
  if (unixUtc < kMinUnix) {
    Serial.println("[clock] ignored a time before 2020");
    return;
  }
  if (offset > kMaxOffset) offset = kMaxOffset;
  if (offset < -kMaxOffset) offset = -kMaxOffset;
  baseUtc = unixUtc;
  offsetSeconds = offset;
  baseTicks = rtcReady ? rtcTicks() : 0;
  everSynced = true;
  if (fromPhone) freshThisBoot = true;
  lastSaveMs = millis();
  Serial.printf("[clock] %s offset=%ld s\n",
                fromPhone ? "phone sync" : "restored",
                static_cast<long>(offsetSeconds));
}

static void loadCheckpoint() {
  if (!InternalFS.begin()) {
    Serial.println("[clock] internal flash did not mount; time resets on reboot");
    return;
  }
  storageReady = true;
  Adafruit_LittleFS_Namespace::File file = InternalFS.open(
      "/time.bin", Adafruit_LittleFS_Namespace::FILE_O_READ);
  if (!file) {
    Serial.println("[clock] no saved time yet");
    return;
  }
  Checkpoint record{};
  const int got = file.read(reinterpret_cast<uint8_t *>(&record), sizeof(record));
  file.close();
  if (got != static_cast<int>(sizeof(record)) || record.magic != kCheckpointMagic ||
      checksum(record) != record.crc || !record.everSynced) {
    Serial.println("[clock] saved time was unreadable");
    return;
  }
  // The RTC just started at 0, so this is the last checkpoint, not the
  // minutes the board was powered off. The syncing dot stays until the phone
  // writes a fresh time.
  remember(record.unixUtc, record.offsetSeconds, false);
  freshThisBoot = false;
}

void clockSaveNow() {
  if (!storageReady || !everSynced) return;
  Checkpoint record{};
  record.magic = kCheckpointMagic;
  record.unixUtc = utcNow();
  record.offsetSeconds = offsetSeconds;
  record.everSynced = 1;
  record.crc = checksum(record);
  Adafruit_LittleFS_Namespace::File file = InternalFS.open(
      "/time.bin", Adafruit_LittleFS_Namespace::FILE_O_WRITE);
  if (!file) {
    Serial.println("[clock] could not open /time.bin");
    return;
  }
  file.write(reinterpret_cast<const uint8_t *>(&record), sizeof(record));
  file.close();
  lastSaveMs = millis();
  Serial.println("[clock] saved");
}

// Days since 1970-01-01. Howard Hinnant's civil calendar, public domain.
static int32_t daysFromCivil(int year, int month, int day) {
  year -= month <= 2;
  const int era = (year >= 0 ? year : year - 399) / 400;
  const unsigned yoe = static_cast<unsigned>(year - era * 400);
  const unsigned doy =
      (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + static_cast<int>(doe) - 719468;
}

static void civilFromDays(int32_t z, int &year, int &month, int &day) {
  z += 719468;
  const int32_t era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = static_cast<unsigned>(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  year = static_cast<int>(yoe) + static_cast<int>(era) * 400;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  day = static_cast<int>(doy - (153 * mp + 2) / 5 + 1);
  month = static_cast<int>(mp < 10 ? mp + 3 : mp - 9);
  year += month <= 2;
}

static int32_t dstSeconds(uint8_t dst) {
  if (dst == 2) return 1800;
  if (dst == 4) return 3600;
  if (dst == 8) return 7200;
  return 0;
}

static void publishStandardTime() {
  if (!everSynced) return;
  const int32_t local = utcNow() + offsetSeconds;
  int32_t days = local / 86400;
  int32_t seconds = local % 86400;
  if (seconds < 0) {
    seconds += 86400;
    days -= 1;
  }
  int year = 1970;
  int month = 1;
  int day = 1;
  civilFromDays(days, year, month, day);
  CurrentTimeBytes current{};
  current.year = static_cast<uint16_t>(year);
  current.month = static_cast<uint8_t>(month);
  current.day = static_cast<uint8_t>(day);
  current.hours = static_cast<uint8_t>(seconds / 3600);
  current.minutes = static_cast<uint8_t>((seconds / 60) % 60);
  current.seconds = static_cast<uint8_t>(seconds % 60);
  // 1970-01-01 was a Thursday. BLE numbers Monday as 1 and Sunday as 7.
  int sunday0 = static_cast<int>((days + 4) % 7);
  if (sunday0 < 0) sunday0 += 7;
  current.weekday = static_cast<uint8_t>(sunday0 == 0 ? 7 : sunday0);
  currentTimeChar.write(reinterpret_cast<uint8_t *>(&current), sizeof(current));

  LocalTimeBytes localInfo{};
  const int32_t quarters = offsetSeconds / 900;
  localInfo.timezoneQuarters = static_cast<int8_t>(quarters);
  localInfo.dstOffset = 0;
  localTimeChar.write(reinterpret_cast<uint8_t *>(&localInfo), sizeof(localInfo));
}

static void applyCurrentTime(const CurrentTimeBytes &current) {
  if (current.year < 2020 || current.month < 1 || current.month > 12 ||
      current.day < 1 || current.day > 31 || current.hours > 23 ||
      current.minutes > 59 || current.seconds > 60) {
    Serial.println("[clock] ignored a Current Time write");
    return;
  }
  const int32_t days = daysFromCivil(current.year, current.month, current.day);
  const int32_t local = days * 86400 + current.hours * 3600 +
                        current.minutes * 60 + current.seconds;
  remember(local - offsetSeconds, offsetSeconds, true);
}

static void applyLocalTime(const LocalTimeBytes &local) {
  if (local.timezoneQuarters == static_cast<int8_t>(-128)) return;
  const int32_t offset =
      static_cast<int32_t>(local.timezoneQuarters) * 900 + dstSeconds(local.dstOffset);
  if (everSynced) remember(utcNow(), offset, true);
  else offsetSeconds = offset;
}

static void onCustomWrite(uint16_t, BLECharacteristic *, uint8_t *data,
                          uint16_t length) {
  if (data == nullptr || length != sizeof(TimeSync)) {
    Serial.println("[clock] time write must be 8 bytes");
    return;
  }
  memcpy(const_cast<TimeSync *>(&pendingCustom), data, sizeof(TimeSync));
  customPending = true;
}

static void onCurrentTimeWrite(uint16_t, BLECharacteristic *, uint8_t *data,
                               uint16_t length) {
  if (data == nullptr || length < sizeof(CurrentTimeBytes)) return;
  memcpy(const_cast<CurrentTimeBytes *>(&pendingCurrent), data,
         sizeof(CurrentTimeBytes));
  currentTimePending = true;
}

static void onLocalTimeWrite(uint16_t, BLECharacteristic *, uint8_t *data,
                             uint16_t length) {
  if (data == nullptr || length < sizeof(LocalTimeBytes)) return;
  memcpy(const_cast<LocalTimeBytes *>(&pendingLocal), data, sizeof(LocalTimeBytes));
  localTimePending = true;
}

void clockBegin() {
  startRtc();
  loadCheckpoint();
  lastSaveMs = millis();
  if (!everSynced) {
    Serial.println("[clock] show --:-- until the Nearby app connects");
  }
}

void clockAddService() {
  timeService.begin();
  timeCharacteristic.setProperties(CHR_PROPS_READ | CHR_PROPS_WRITE |
                                   CHR_PROPS_WRITE_WO_RESP);
  timeCharacteristic.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  timeCharacteristic.setFixedLen(sizeof(TimeSync));
  timeCharacteristic.setWriteCallback(onCustomWrite);
  timeCharacteristic.begin();
  TimeSync blank{};
  timeCharacteristic.write(reinterpret_cast<uint8_t *>(&blank), sizeof(blank));

  // Optional standard Current Time Service. A phone that only speaks the
  // custom characteristic can ignore this. iOS does not write it on its own.
  ctsService.begin();
  currentTimeChar.setProperties(CHR_PROPS_READ | CHR_PROPS_WRITE |
                                CHR_PROPS_WRITE_WO_RESP);
  currentTimeChar.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  currentTimeChar.setFixedLen(sizeof(CurrentTimeBytes));
  currentTimeChar.setWriteCallback(onCurrentTimeWrite);
  currentTimeChar.begin();

  localTimeChar.setProperties(CHR_PROPS_READ | CHR_PROPS_WRITE |
                              CHR_PROPS_WRITE_WO_RESP);
  localTimeChar.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  localTimeChar.setFixedLen(sizeof(LocalTimeBytes));
  localTimeChar.setWriteCallback(onLocalTimeWrite);
  localTimeChar.begin();
  Serial.println("[clock] time service ready");
}

void clockPoll() {
  bool changed = false;
  if (localTimePending) {
    localTimePending = false;
    LocalTimeBytes local{};
    noInterrupts();
    memcpy(&local, const_cast<const LocalTimeBytes *>(&pendingLocal), sizeof(local));
    interrupts();
    applyLocalTime(local);
    changed = true;
  }
  if (currentTimePending) {
    currentTimePending = false;
    CurrentTimeBytes current{};
    noInterrupts();
    memcpy(&current, const_cast<const CurrentTimeBytes *>(&pendingCurrent),
           sizeof(current));
    interrupts();
    applyCurrentTime(current);
    changed = true;
  }
  if (customPending) {
    customPending = false;
    TimeSync sync{};
    noInterrupts();
    memcpy(&sync, const_cast<const TimeSync *>(&pendingCustom), sizeof(sync));
    interrupts();
    remember(sync.unixSeconds, sync.offsetSeconds, true);
    changed = true;
  }
  if (changed) {
    publishStandardTime();
    clockSaveNow();
  } else if (everSynced && millis() - lastSaveMs >= kSaveEveryMs) {
    clockSaveNow();
  }
}

bool clockHasTime() { return everSynced; }
bool clockIsFresh() { return freshThisBoot; }

int32_t clockLocalUnix() { return utcNow() + offsetSeconds; }

static void copyInto(char *dest, size_t destLen, const char *src) {
  if (destLen == 0) return;
  strncpy(dest, src, destLen - 1);
  dest[destLen - 1] = '\0';
}

void clockWriteFace(char *hhmm, size_t hhmmLen, bool *isPm, char *date,
                    size_t dateLen) {
  if (hhmm == nullptr || isPm == nullptr || date == nullptr) return;
  if (!everSynced) {
    copyInto(hhmm, hhmmLen, "--:--");
    date[0] = '\0';
    *isPm = false;
    return;
  }
  int32_t local = utcNow() + offsetSeconds;
  int32_t days = local / 86400;
  int32_t seconds = local % 86400;
  if (seconds < 0) {
    seconds += 86400;
    days -= 1;
  }
  const int hour24 = (int)(seconds / 3600);
  const int minute = (int)((seconds / 60) % 60);
  *isPm = hour24 >= 12;
  int hour12 = hour24 % 12;
  if (hour12 == 0) hour12 = 12;
  snprintf(hhmm, hhmmLen, "%d:%02d", hour12, minute);

  int year = 1970;
  int month = 1;
  int day = 1;
  civilFromDays(days, year, month, day);
  static const char *kWeekdays[] = {"Sun", "Mon", "Tue", "Wed",
                                    "Thu", "Fri", "Sat"};
  static const char *kMonths[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
  int weekday = (int)((days + 4) % 7);
  if (weekday < 0) weekday += 7;
  if (month < 1) month = 1;
  if (month > 12) month = 12;
  (void)year;
  snprintf(date, dateLen, "%s, %s %d", kWeekdays[weekday], kMonths[month - 1],
           day);
}
