import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

const memory = new Map<string, { email: string; createdAt: number }>();

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (email.length > 320) return null;
  return email;
}

function emailDocId(email: string): string {
  return encodeURIComponent(email);
}

export async function joinWaitlist(input: {
  email: string;
  source?: string;
}): Promise<{ email: string; createdAt: number; alreadyJoined: boolean }> {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("Invalid email");

  const createdAt = Date.now();
  const source = input.source?.trim() || "marketing";
  const id = emailDocId(email);

  if (!isFirebaseConfigured()) {
    const existing = memory.has(id);
    if (!existing) {
      memory.set(id, { email, createdAt });
    }
    return {
      email,
      createdAt: memory.get(id)?.createdAt ?? createdAt,
      alreadyJoined: existing,
    };
  }

  const ref = getFirebaseAdmin().firestore().collection("waitlist").doc(id);
  const existing = await ref.get();
  if (existing.exists) {
    const data = existing.data() ?? {};
    return {
      email,
      createdAt: Number(data.createdAt ?? createdAt),
      alreadyJoined: true,
    };
  }

  await ref.set({
    email,
    source,
    createdAt,
    updatedAt: createdAt,
  });

  return { email, createdAt, alreadyJoined: false };
}
