import assert from "node:assert/strict";
import test from "node:test";
import {
  MessagingError,
  blockConversationUser,
  listMessages,
  resetMessagingMocksForTest,
  sendMessage,
  startConversation,
} from "./messaging.js";
import {
  checkPhoneVerification,
  provisionNearbyNumber,
  resetPhoneMocksForTest,
  startPhoneVerification,
} from "./phone.js";

test.beforeEach(() => {
  process.env.TWILIO_MOCK = "true";
  resetMessagingMocksForTest();
  resetPhoneMocksForTest();
});

test("persists messages in both directions for one conversation", async () => {
  await startPhoneVerification("personal-user", "+14155550123");
  await checkPhoneVerification("personal-user", "000000");
  await provisionNearbyNumber("seed-maya", true);
  const conversation = await startConversation("personal-user", "seed-maya");
  const outgoing = await sendMessage(
    "personal-user",
    conversation.id,
    "Hello from a personal-number account",
  );
  const incoming = await sendMessage(
    "seed-maya",
    conversation.id,
    "Hello from an assigned-number account",
  );
  const history = await listMessages("personal-user", conversation.id);
  assert.deepEqual(
    history.map((message) => message.id),
    [outgoing.id, incoming.id],
  );
});

test("enforces conversation authorization", async () => {
  const conversation = await startConversation("user-a", "seed-maya");
  await assert.rejects(
    listMessages("stranger", conversation.id),
    (error: unknown) =>
      error instanceof MessagingError && error.status === 404,
  );
});

test("blocking prevents further messages in either direction", async () => {
  const conversation = await startConversation("user-a", "seed-maya");
  await blockConversationUser("user-a", conversation.id);
  await assert.rejects(
    sendMessage("seed-maya", conversation.id, "Should not send"),
    (error: unknown) =>
      error instanceof MessagingError && error.code === "blocked",
  );
});

test("rate limits message bursts", async () => {
  const conversation = await startConversation("user-a", "seed-maya");
  for (let index = 0; index < 30; index += 1) {
    await sendMessage("user-a", conversation.id, `Message ${index}`);
  }
  await assert.rejects(
    sendMessage("user-a", conversation.id, "One too many"),
    (error: unknown) =>
      error instanceof MessagingError && error.code === "rate_limited",
  );
});
