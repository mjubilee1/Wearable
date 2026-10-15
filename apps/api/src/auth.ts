import {
  JUNK_EMAIL_MESSAGE,
  isDottedJunkEmail,
  passwordUserNeedsEmailVerification,
} from "@nearby/shared";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

export type AuthUser = {
  uid: string;
  email?: string;
  emailVerified: boolean;
  signInProvider: string | null;
};

export type AccountAccessBlock =
  | { status: 403; error: "email_not_verified" }
  | { status: 400; error: typeof JUNK_EMAIL_MESSAGE };

const creationTimeCache = new Map<string, number>();

/** Account status stays readable. Resend uses the Firebase client SDK, not the API. */
export function isEmailVerificationExempt(method: string, path: string): boolean {
  return method === "GET" && path === "/v1/me";
}

export function accountAccessBlock(input: {
  email?: string;
  emailVerified: boolean;
  signInProvider: string | null;
  createdAtMs: number | null;
  exempt: boolean;
}): AccountAccessBlock | null {
  if (input.signInProvider === "google.com") return null;
  if (
    input.signInProvider === "password" &&
    input.email &&
    isDottedJunkEmail(input.email)
  ) {
    return { status: 400, error: JUNK_EMAIL_MESSAGE };
  }
  if (input.exempt) return null;
  if (
    passwordUserNeedsEmailVerification({
      emailVerified: input.emailVerified,
      providerId: input.signInProvider,
      createdAtMs: input.createdAtMs ?? 0,
    })
  ) {
    return { status: 403, error: "email_not_verified" };
  }
  return null;
}

async function creationTimeMs(uid: string): Promise<number | null> {
  const cached = creationTimeCache.get(uid);
  if (cached !== undefined) return cached;
  const record = await getFirebaseAdmin().auth().getUser(uid);
  const created = Date.parse(record.metadata.creationTime);
  if (!Number.isFinite(created)) return null;
  creationTimeCache.set(uid, created);
  return created;
}

export async function verifyAuth(
  header: string | undefined,
): Promise<AuthUser | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  if (!isFirebaseConfigured()) {
    // Local/dev fallback so web + mobile can hit the API without Admin creds yet
    if (token === "dev") {
      return {
        uid: "dev-user",
        email: "dev@nearby.local",
        emailVerified: true,
        signInProvider: null,
      };
    }
    return {
      uid: `token-${token.slice(0, 8)}`,
      email: undefined,
      emailVerified: true,
      signInProvider: null,
    };
  }

  try {
    const decoded = await getFirebaseAdmin().auth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified === true,
      signInProvider: decoded.firebase?.sign_in_provider ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Block unverified password accounts created after the cutoff.
 * Invalid tokens return null so the route can answer 401.
 * A failed creation-time lookup grandfathers the account instead of locking it out.
 */
export async function accountAccessFromHeader(
  header: string | undefined,
  exempt: boolean,
): Promise<AccountAccessBlock | null> {
  if (!header?.startsWith("Bearer ")) return null;
  if (!isFirebaseConfigured()) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  let decoded: {
    uid: string;
    email?: string;
    email_verified?: boolean;
    firebase?: { sign_in_provider?: string };
  };
  try {
    decoded = await getFirebaseAdmin().auth().verifyIdToken(token);
  } catch {
    return null;
  }

  const signInProvider = decoded.firebase?.sign_in_provider ?? null;
  const emailVerified = decoded.email_verified === true;
  let createdAtMs: number | null = null;
  if (signInProvider === "password" && !emailVerified) {
    try {
      createdAtMs = await creationTimeMs(decoded.uid);
    } catch (error) {
      console.error("[auth] creation time", error);
      createdAtMs = null;
    }
  }

  return accountAccessBlock({
    email: decoded.email,
    emailVerified,
    signInProvider,
    createdAtMs,
    exempt,
  });
}
