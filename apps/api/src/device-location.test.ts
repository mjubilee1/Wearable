import assert from "node:assert/strict";
import test from "node:test";
import { isDeviceLocation, turnNeedsDeviceLocation } from "@nearby/shared";

test("GPS is requested only for where-you-are questions", () => {
  assert.equal(turnNeedsDeviceLocation("What's the weather?"), true);
  assert.equal(turnNeedsDeviceLocation("coffee near me"), true);
  assert.equal(turnNeedsDeviceLocation("what's nearby"), true);
  assert.equal(turnNeedsDeviceLocation("how far is the airport"), true);
  assert.equal(turnNeedsDeviceLocation("what's the weather in Washington DC today"), false);
  assert.equal(turnNeedsDeviceLocation("What's on my calendar today?"), false);
  assert.equal(turnNeedsDeviceLocation("hello nearby"), false);
});

test("device location rejects out-of-range coordinates", () => {
  assert.equal(isDeviceLocation({ latitude: 40.7, longitude: -74 }), true);
  assert.equal(isDeviceLocation({ latitude: 91, longitude: 0 }), false);
  assert.equal(isDeviceLocation({ latitude: "40", longitude: -74 }), false);
});
