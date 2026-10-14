#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>

#include "ble_audio.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Copy include/secrets.h.example to include/secrets.h"
#endif

constexpr char WAKE_PHRASE[] = "hello nearby";
constexpr uint32_t WAKE_TIMEOUT_MS = 15000;

bool waitingForCommand = false;
uint32_t activatedAt = 0;

bool isWordCharacter(char value) {
  return (value >= 'a' && value <= 'z') ||
         (value >= 'A' && value <= 'Z') ||
         (value >= '0' && value <= '9') ||
         value == '_';
}

bool postAgent(const String &text) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi dropped.");
    return false;
  }

  JsonDocument doc;
  doc["text"] = text;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  const String url = String(API_BASE) + "/v1/agent";
  if (!http.begin(url)) {
    Serial.println("Could not open the agent URL.");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  http.setTimeout(15000);

  const int code = http.POST(body);
  const String response = http.getString();
  http.end();

  if (code <= 0) {
    Serial.printf("Agent request failed (%d)\n", code);
    return false;
  }

  JsonDocument replyDoc;
  const DeserializationError err = deserializeJson(replyDoc, response);
  if (err) {
    Serial.printf("Agent HTTP %d, unreadable body\n", code);
    Serial.println(response);
    return false;
  }
  if (code != 200) {
    const char *message = replyDoc["error"] | "Agent rejected the turn";
    Serial.println(message);
    return false;
  }

  const char *reply = replyDoc["reply"] | "";
  Serial.println(reply);
  return true;
}

String commandAfterWakePhrase(const String &spoken) {
  String normalized = spoken;
  normalized.trim();
  normalized.toLowerCase();
  const String wake = WAKE_PHRASE;
  if (!normalized.startsWith(wake)) return "";
  if (normalized.length() > wake.length()) {
    const char boundary = normalized.charAt(wake.length());
    if (isWordCharacter(boundary)) return "";
  }

  String command = spoken.substring(wake.length());
  command.trim();
  while (
    command.length() &&
    (command.charAt(0) == ',' || command.charAt(0) == ':' ||
     command.charAt(0) == '-' || command.charAt(0) == '.')
  ) {
    command.remove(0, 1);
    command.trim();
  }
  return command;
}

bool hasWakePhrase(const String &spoken) {
  String normalized = spoken;
  normalized.trim();
  normalized.toLowerCase();
  const String wake = WAKE_PHRASE;
  if (!normalized.startsWith(wake)) return false;
  return normalized.length() == wake.length() ||
         !isWordCharacter(normalized.charAt(wake.length()));
}

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println(
    "Nearby voice. Wi-Fi only. Type \"Hello Nearby\" to activate."
  );
  ble_audio_setup();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Joining Wi-Fi");
  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi failed. Check secrets.h.");
  }
}

void loop() {
  if (
    waitingForCommand &&
    static_cast<uint32_t>(millis() - activatedAt) >= WAKE_TIMEOUT_MS
  ) {
    waitingForCommand = false;
    Serial.println("Nearby went idle. Say \"Hello Nearby\" to activate.");
  }
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (!line.length()) return;

  if (waitingForCommand) {
    waitingForCommand = false;
    postAgent(line);
    return;
  }

  if (!hasWakePhrase(line)) {
    Serial.println("Idle. Say \"Hello Nearby\" first.");
    return;
  }

  const String command = commandAfterWakePhrase(line);
  if (command.length()) {
    postAgent(command);
    return;
  }

  waitingForCommand = true;
  activatedAt = millis();
  Serial.println("Listening. Say one command.");
}
