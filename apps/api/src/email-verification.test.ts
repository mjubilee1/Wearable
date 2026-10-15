import assert from "node:assert/strict";
import test from "node:test";
import {
  EMAIL_VERIFICATION_REQUIRED_AFTER_MS,
  JUNK_EMAIL_MESSAGE,
  isDottedJunkEmail,
  passwordUserNeedsEmailVerification,
} from "@nearby/shared";
import { accountAccessBlock, isEmailVerificationExempt } from "./auth.js";

const after = EMAIL_VERIFICATION_REQUIRED_AFTER_MS;
const before = after - 1;

test("dotted gmail local parts with 3 or more dots are junk", () => {
  assert.equal(isDottedJunkEmail("l.o.beja.y.iw8.5@gmail.com"), true);
  assert.equal(isDottedJunkEmail("a.b.c.d@googlemail.com"), true);
  assert.equal(isDottedJunkEmail("a.b.c@gmail.com"), false);
  assert.equal(isDottedJunkEmail("first.last@gmail.com"), false);
  assert.equal(isDottedJunkEmail("a.b.c.d@example.com"), false);
});

test("password accounts created before the cutoff stay usable", () => {
  assert.equal(
    passwordUserNeedsEmailVerification({
      emailVerified: false,
      providerId: "password",
      createdAtMs: before,
    }),
    false,
  );
  assert.equal(
    passwordUserNeedsEmailVerification({
      emailVerified: false,
      providerId: "password",
      createdAtMs: after,
    }),
    true,
  );
  assert.equal(
    passwordUserNeedsEmailVerification({
      emailVerified: true,
      providerId: "password",
      createdAtMs: after,
    }),
    false,
  );
  assert.equal(
    passwordUserNeedsEmailVerification({
      emailVerified: false,
      providerId: "google.com",
      createdAtMs: after,
    }),
    false,
  );
});

test("API blocks new unverified password users and dotted Gmail, not Google or status", () => {
  assert.equal(isEmailVerificationExempt("GET", "/v1/me"), true);
  assert.equal(isEmailVerificationExempt("POST", "/v1/billing/checkout"), false);
  assert.equal(isEmailVerificationExempt("POST", "/v1/agent"), false);

  assert.deepEqual(
    accountAccessBlock({
      email: "new@example.com",
      emailVerified: false,
      signInProvider: "password",
      createdAtMs: after,
      exempt: false,
    }),
    { status: 403, error: "email_not_verified" },
  );
  assert.equal(
    accountAccessBlock({
      email: "new@example.com",
      emailVerified: false,
      signInProvider: "password",
      createdAtMs: after,
      exempt: true,
    }),
    null,
  );
  assert.equal(
    accountAccessBlock({
      email: "old@example.com",
      emailVerified: false,
      signInProvider: "password",
      createdAtMs: before,
      exempt: false,
    }),
    null,
  );
  assert.equal(
    accountAccessBlock({
      email: "person@gmail.com",
      emailVerified: false,
      signInProvider: "google.com",
      createdAtMs: after,
      exempt: false,
    }),
    null,
  );
  assert.equal(
    accountAccessBlock({
      email: "unknown-created@example.com",
      emailVerified: false,
      signInProvider: "password",
      createdAtMs: null,
      exempt: false,
    }),
    null,
  );
  assert.deepEqual(
    accountAccessBlock({
      email: "l.o.beja.y.iw8.5@gmail.com",
      emailVerified: false,
      signInProvider: "password",
      createdAtMs: after,
      exempt: true,
    }),
    { status: 400, error: JUNK_EMAIL_MESSAGE },
  );
});
