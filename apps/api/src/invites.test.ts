import assert from "node:assert/strict";
import test from "node:test";
import { acceptInvite, createInvite, resetInvitesForTest, blockPairForTest } from "./invites.js";

test.beforeEach(() => {
  resetInvitesForTest();
});

test("reuses one invite link per account", async () => {
  const first = await createInvite("user-a");
  const second = await createInvite("user-a");
  assert.equal(first.code, second.code);
  assert.match(first.code, /^[A-Za-z0-9_-]{8,32}$/);
});

test("accepting an invite connects the two accounts once", async () => {
  const { code } = await createInvite("user-a");
  const first = await acceptInvite("user-b", code);
  const second = await acceptInvite("user-b", code);
  assert.equal(first.otherId, "user-a");
  assert.equal(second.otherId, "user-a");
});

test("rejects your own invite and unknown links", async () => {
  const { code } = await createInvite("user-a");
  await assert.rejects(acceptInvite("user-a", code), /your invite/);
  await assert.rejects(acceptInvite("user-b", "not-a-real-code"), /not valid/);
});

test("does not connect a blocked pair", async () => {
  const { code } = await createInvite("user-a");
  blockPairForTest("user-a", "user-b");
  await assert.rejects(acceptInvite("user-b", code), /unavailable/);
});
