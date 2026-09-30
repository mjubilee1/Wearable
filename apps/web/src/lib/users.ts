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
  type ProfilePrompt,
  type UpdateUserInput,
  type UserProfile,
} from "@nearby/shared";
import { db } from "@/lib/firebase";

const USERS = "users";

export { compatibilityScore, vibeCaption, SEED_PROFILES };

function mapPrompts(raw: unknown): ProfilePrompt[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const question = String(row.question ?? "").trim();
      const answer = String(row.answer ?? "").trim();
      if (!question || !answer) return null;
      return {
        id: String(row.id ?? `prompt-${index}`),
        question,
        answer,
      };
    })
    .filter((item): item is ProfilePrompt => Boolean(item));
}

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
    initials: String(
      data.initials ?? initialsFromName(String(data.name ?? "?")),
    ),
    photoUrl:
      data.photoUrl === undefined || data.photoUrl === null
        ? null
        : String(data.photoUrl),
    bio: String(data.bio ?? ""),
    lookingFor: String(data.lookingFor ?? ""),
    prompts: mapPrompts(data.prompts),
    vibes: Array.isArray(data.vibes) ? data.vibes.map(String) : [],
    deviceId:
      data.deviceId === undefined || data.deviceId === null
        ? null
        : String(data.deviceId),
    plan: data.plan === "plus" ? "plus" : "free",
    subscriptionStatus:
      typeof data.subscriptionStatus === "string"
        ? (data.subscriptionStatus as UserProfile["subscriptionStatus"])
        : "none",
    stripeCustomerId:
      data.stripeCustomerId === undefined || data.stripeCustomerId === null
        ? null
        : String(data.stripeCustomerId),
    stripeSubscriptionId:
      data.stripeSubscriptionId === undefined ||
      data.stripeSubscriptionId === null
        ? null
        : String(data.stripeSubscriptionId),
    planUpdatedAt:
      data.planUpdatedAt === undefined
        ? undefined
        : Number(data.planUpdatedAt),
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
    photoUrl: null,
    bio: "",
    lookingFor: "",
    prompts: [],
    vibes: [],
    deviceId: null,
    plan: "free",
    subscriptionStatus: "none",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(db, USERS, input.uid), profile);
  return profile;
}

export async function updateUserProfile(
  uid: string,
  patch: UpdateUserInput,
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
  if (patch.photoUrl !== undefined) updates.photoUrl = patch.photoUrl;
  if (patch.bio !== undefined) updates.bio = patch.bio.trim();
  if (patch.lookingFor !== undefined) updates.lookingFor = patch.lookingFor;
  if (patch.prompts !== undefined) updates.prompts = patch.prompts;
  if (patch.vibes !== undefined) updates.vibes = patch.vibes;
  if (patch.deviceId !== undefined) updates.deviceId = patch.deviceId;

  await updateDoc(doc(db, USERS, uid), updates);
}

export async function listNearbyMatches(
  self: UserProfile,
  options?: { excludeIds?: Set<string> },
): Promise<MatchProfile[]> {
  const snap = await getDocs(collection(db, USERS));
  const exclude = options?.excludeIds ?? new Set<string>();

  return snap.docs
    .map((item) => mapUser(item.id, item.data()))
    .filter((other) => other.id !== self.id && !exclude.has(other.id))
    .map((other) => {
      const score = compatibilityScore(self, other);
      return {
        id: other.id,
        email: "",
        name: other.name,
        age: other.age,
        role: other.role,
        interests: other.interests,
        avatarHue: other.avatarHue,
        initials: other.initials,
        photoUrl: other.photoUrl ?? null,
        bio: other.bio ?? "",
        lookingFor: other.lookingFor ?? "",
        prompts: other.prompts ?? [],
        vibes: other.vibes ?? [],
        deviceId: null,
        createdAt: other.createdAt,
        updatedAt: other.updatedAt,
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
