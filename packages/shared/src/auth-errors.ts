/** Maps Firebase Auth (and similar) errors into short copy people can act on. */

const CODE_MESSAGES: Record<string, string> = {
  "auth/wrong-password":
    "That email or password does not match. Try again, or reset your password.",
  "auth/invalid-credential":
    "That email or password does not match. Try again, or reset your password.",
  "auth/invalid-login-credentials":
    "That email or password does not match. Try again, or reset your password.",
  "auth/user-not-found":
    "That email or password does not match. Try again, or reset your password.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/missing-password": "Enter your password.",
  "auth/missing-email": "Enter your email.",
  "auth/too-many-requests":
    "Too many attempts. Wait a minute, then try again or reset your password.",
  "auth/network-request-failed":
    "Network issue. Check your connection and try again.",
  "auth/user-disabled": "This account is disabled. Contact support if that seems wrong.",
  "auth/email-already-in-use":
    "An account already exists with that email. Sign in, or reset your password.",
  "auth/weak-password": "Use a password with at least 6 characters.",
  "auth/operation-not-allowed": "Email sign-in is temporarily unavailable.",
  "auth/requires-recent-login": "Sign in again to continue.",
  "auth/popup-closed-by-user": "Sign-in was cancelled.",
  "auth/cancelled-popup-request": "Sign-in was cancelled.",
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups and try again.",
};

function authCodeFrom(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const row = error as { code?: unknown; message?: unknown };
  if (typeof row.code === "string" && row.code.startsWith("auth/")) {
    return row.code;
  }
  if (typeof row.message === "string") {
    const match = row.message.match(/auth\/[a-z0-9-]+/i);
    if (match) return match[0].toLowerCase();
  }
  return null;
}

function looksLikeWrongPassword(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("wrong-password") ||
    lower.includes("invalid-credential") ||
    lower.includes("invalid login") ||
    lower.includes("invalid-login") ||
    (lower.includes("password") &&
      (lower.includes("invalid") ||
        lower.includes("incorrect") ||
        lower.includes("wrong")))
  );
}

export function friendlyAuthError(
  error: unknown,
  fallback = "Could not complete that. Try again.",
): string {
  const code = authCodeFrom(error);
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];

  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return fallback;
  if (looksLikeWrongPassword(message)) {
    return CODE_MESSAGES["auth/invalid-credential"];
  }
  if (/firebase|auth\//i.test(message)) {
    return fallback;
  }
  return message;
}
