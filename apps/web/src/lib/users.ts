import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import {
  SEED_PROFILES,
  compatibilityScore,
  hueFromSeed,
  initialsFromName,
  vibeCaption,
  type MatchProfile,
  type UserProfile,
} from "@nearby/shared";
import { db } from "@/lib/firebase";

const USERS = "users";

export { compatibilityScore, vibeCaption, SEED_PROFILES };

function mapUser(id: string, data: DocumentData): UserProfile {
  return {
    id,
    email: String(data.email ?? ""),
    name: String(data.name ?? "Neighbor"),
    age: Number(data.age ?? 0),
    role: String(data.role ?? ""),
    interests: Array.isArray(data.interests)
      ? data.interests.map(String)
      : [],
    avatarHue: Number(data.avatarHue ?? hueFromSeed(id)),
    initials: String(data.initials ?? initialsFromName(String(data.name ?? "?"))),
    createdAt: Number(data.createdAt ?? Date.now()),
    updatedAt: Number(data.updatedAt ?? Date.now()),
  };
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, USERS, uid));
  if (!snap.exists()) return null;
  return mapUser(snap.id, snap.data());
}

export async function createUserProfile(input: {
  uid: string;
  email: string;
  name: string;
  age: number;
  role: string;
  interests: string[];
}): Promise<UserProfile> {
  const now = Date.now();
  const profile: UserProfile = {
    id: input.uid,
    email: input.email,
    name: input.name.trim(),
    age: input.age,
    role: input.role.trim(),
    interests: input.interests,
    avatarHue: hueFromSeed(input.uid),
    initials: initialsFromName(input.name),
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(db, USERS, input.uid), profile);
  return profile;
}

export async function updateUserProfile(
  uid: string,
  patch: Partial<Pick<UserProfile, "name" | "age" | "role" | "interests">>,
): Promise<void> {
  const updates: Record<string, unknown> = {
    updatedAt: Date.now(),
  };

  if (patch.name !== undefined) {
    updates.name = patch.name.trim();
    updates.initials = initialsFromName(patch.name);
  }
  if (patch.age !== undefined) updates.age = patch.age;
  if (patch.role !== undefined) updates.role = patch.role.trim();
  if (patch.interests !== undefined) updates.interests = patch.interests;

  await updateDoc(doc(db, USERS, uid), updates);
}

export async function listNearbyMatches(
  self: UserProfile,
): Promise<MatchProfile[]> {
  const snap = await getDocs(collection(db, USERS));

  return snap.docs
    .map((item) => mapUser(item.id, item.data()))
    .filter((other) => other.id !== self.id)
    .map((other) => {
      const score = compatibilityScore(self, other);
      return {
        ...other,
        score,
        vibeCaption: vibeCaption(other.name, score),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export async function ensureSeedProfiles(): Promise<void> {
  await Promise.all(
    SEED_PROFILES.map(async (profile) => {
      const ref = doc(db, USERS, profile.id);
      const existing = await getDoc(ref);
      if (existing.exists()) return;
      const now = Date.now();
      await setDoc(ref, { ...profile, createdAt: now, updatedAt: now });
    }),
  );
}
