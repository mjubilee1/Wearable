import assert from "node:assert/strict";
import test from "node:test";
import { friendlyAuthError } from "./auth-errors.js";

test("maps common Firebase wrong-password codes to a clear message", () => {
  for (const code of [
    "auth/wrong-password",
    "auth/invalid-credential",
    "auth/invalid-login-credentials",
    "auth/user-not-found",
  ]) {
    assert.equal(
      friendlyAuthError({ code, message: `Firebase: Error (${code}).` }),
      "That email or password does not match. Try again, or reset your password.",
    );
  }
});

test("falls back for unknown errors without leaking Firebase jargon", () => {
  assert.equal(
    friendlyAuthError(
      { code: "auth/internal-error", message: "Firebase: Error (auth/internal-error)." },
      "Could not sign in",
    ),
    "Could not sign in",
  );
  assert.equal(
    friendlyAuthError(new Error("Enter your first name, not your email.")),
    "Enter your first name, not your email.",
  );
});
