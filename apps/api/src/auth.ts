import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

export type AuthUser = {
  uid: string;
  email?: string;
};

export async function verifyAuth(
  header: string | undefined,
): Promise<AuthUser | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  if (!isFirebaseConfigured()) {
    // Local/dev fallback so web + mobile can hit the API without Admin creds yet
    if (token === "dev") {
      return { uid: "dev-user", email: "dev@nearby.local" };
    }
    return { uid: `token-${token.slice(0, 8)}`, email: undefined };
  }

  try {
    const decoded = await getFirebaseAdmin().auth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email };
  } catch {
    return null;
  }
}
