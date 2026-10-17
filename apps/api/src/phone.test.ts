import assert from "node:assert/strict";
import test from "node:test";
import {
  checkPhoneVerification,
  getPhoneStatus,
  normalizePhoneNumber,
  provisionNearbyNumber,
  resetPhoneMocksForTest,
  startPhoneVerification,
} from "./phone.js";

test.beforeEach(() => {
  process.env.TWILIO_MOCK = "true";
  delete process.env.TWILIO_MOCK_PROVISION_FAILURE_ONCE;
  resetPhoneMocksForTest();
});

test("normalizes US and E.164 phone numbers", () => {
  assert.equal(normalizePhoneNumber("(415) 555-0123"), "+14155550123");
  assert.equal(normalizePhoneNumber("+44 20 7946 0958"), "+442079460958");
  assert.throws(() => normalizePhoneNumber("123"));
});

test("verifies an existing number and rejects invalid or expired codes", async () => {
  await startPhoneVerification("user-a", "415-555-0123");
  await assert.rejects(
    checkPhoneVerification("user-a", "123456"),
    /invalid or expired/,
  );
  const status = await checkPhoneVerification("user-a", "000000");
  assert.equal(status.phoneNumber, "+14155550123");
  assert.equal(status.phoneNumberType, "PERSONAL");
  assert.equal(status.phoneVerified, true);
});

test("enforces verified personal number uniqueness", async () => {
  await startPhoneVerification("user-a", "+14155550123");
  await checkPhoneVerification("user-a", "000000");
  await startPhoneVerification("user-b", "+14155550123");
  await assert.rejects(
    checkPhoneVerification("user-b", "000000"),
    /already in use/,
  );
});

test("provisioning requires confirmation and is idempotent", async () => {
  await assert.rejects(provisionNearbyNumber("user-a", false), /Confirm/);
  const first = await provisionNearbyNumber("user-a", true);
  const second = await provisionNearbyNumber("user-a", true);
  assert.equal(first.phoneNumberType, "NEARBY_ASSIGNED");
  assert.equal(first.twilioPhoneNumberSid, second.twilioPhoneNumberSid);
  assert.equal((await getPhoneStatus("user-a")).phoneProvisioningStatus, "ACTIVE");
});

test("retries safely after a provisioning failure", async () => {
  process.env.TWILIO_MOCK_PROVISION_FAILURE_ONCE = "true";
  await assert.rejects(
    provisionNearbyNumber("user-a", true),
    /Mock provisioning failure/,
  );
  assert.equal((await getPhoneStatus("user-a")).phoneProvisioningStatus, "FAILED");
  const recovered = await provisionNearbyNumber("user-a", true);
  assert.equal(recovered.phoneProvisioningStatus, "ACTIVE");
});
