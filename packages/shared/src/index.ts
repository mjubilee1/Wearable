export type ProfilePrompt = {
  id: string;
  question: string;
  answer: string;
};

export type UserProfile = {
  id: string;
  email: string;
  name: string;
  age: number;
  role: string;
  interests: string[];
  avatarHue: number;
  initials: string;
  /** Optional profile photo URL (Firebase Storage or external). */
  photoUrl?: string | null;
  /** Short free-text intro. */
  bio?: string;
  /** What they're open to nearby (friends, collab, etc.). */
  lookingFor?: string;
  /** Voluntary Q&A prompts. */
  prompts?: ProfilePrompt[];
  /** Soft vibe tags, separate from interests. */
  vibes?: string[];
  /** Wearable device short ID (e.g. A1B2 from NB-A1B2). */
  deviceId?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type MatchProfile = UserProfile & {
  score: number;
  vibeCaption: string;
};

export type CreateUserInput = {
  email: string;
  name: string;
  age: number;
  role: string;
  interests: string[];
  bio?: string;
  lookingFor?: string;
  vibes?: string[];
};

export type UpdateUserInput = Partial<
  Pick<
    UserProfile,
    | "name"
    | "age"
    | "role"
    | "interests"
    | "photoUrl"
    | "bio"
    | "lookingFor"
    | "prompts"
    | "vibes"
    | "deviceId"
  >
>;

export type FacilitateRequest = {
  selfId: string;
  otherId: string;
};

export type FacilitateResponse = {
  whyYouVibe: string;
  icebreakers: string[];
  mode: "mock" | "llm";
};

/** Intro hello before mutual accept — never opens free chat. */
export type ConnectionRequestStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "expired";

export type ConnectionRequest = {
  id: string;
  /** Deterministic pair key: sortedUidA_sortedUidB */
  pairId: string;
  fromId: string;
  toId: string;
  message: string;
  status: ConnectionRequestStatus;
  createdAt: number;
  updatedAt: number;
  respondedAt?: number | null;
};

export type Connection = {
  id: string;
  pairId: string;
  userIds: [string, string];
  requestId: string;
  createdAt: number;
};

export type UserBlock = {
  id: string;
  blockerId: string;
  blockedId: string;
  createdAt: number;
};

/**
 * What someone may see before a mutual connection.
 * No email, deviceId, or other contact/location trails.
 */
export type PublicProfilePreview = {
  id: string;
  name: string;
  age: number;
  role: string;
  interests: string[];
  avatarHue: number;
  initials: string;
  photoUrl?: string | null;
  bio?: string;
  lookingFor?: string;
  vibes?: string[];
  prompts?: ProfilePrompt[];
};

export const INTRO_MESSAGE_MAX = 200;
/** After a quiet decline, same sender cannot re-request for this long. */
export const DECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function pairIdFor(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function toPublicPreview(profile: UserProfile): PublicProfilePreview {
  return {
    id: profile.id,
    name: profile.name,
    age: profile.age,
    role: profile.role,
    interests: profile.interests,
    avatarHue: profile.avatarHue,
    initials: profile.initials,
    photoUrl: profile.photoUrl ?? null,
    bio: profile.bio ?? "",
    lookingFor: profile.lookingFor ?? "",
    vibes: profile.vibes ?? [],
    prompts: profile.prompts ?? [],
  };
}

/** Strip links/handles and clamp length for intro hellos. */
export function sanitizeIntroMessage(raw: string): string {
  const cleaned = raw
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(/@[\w.]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, INTRO_MESSAGE_MAX);
}

export const PROFILE_PROMPT_BANK = [
  "A perfect Saturday nearby looks like…",
  "I'm unusually good at…",
  "Ask me about…",
  "I'm looking for people who…",
  "My unpopular opinion is…",
] as const;

export const LOOKING_FOR_OPTIONS = [
  "New friends",
  "Creative collabs",
  "Activity buddies",
  "Just vibing",
  "Professional connect",
] as const;

export const VIBE_OPTIONS = [
  "Chill",
  "Curious",
  "Outgoing",
  "Low-key",
  "Adventurous",
  "Thoughtful",
] as const;

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function hueFromSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function pairBoost(a: string, b: string): number {
  const [x, y] = a < b ? [a, b] : [b, a];
  let hash = 0;
  const key = `${x}:${y}`;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 33 + key.charCodeAt(i)) >>> 0;
  }
  return hash % 30;
}

function sharedCount(a: string[] | undefined, b: string[] | undefined): number {
  if (!a?.length || !b?.length) return 0;
  return a.filter((item) => b.includes(item)).length;
}

/** Deterministic compatibility from opted-in structured fields. */
export function compatibilityScore(
  self: UserProfile,
  other: UserProfile,
): number {
  const interestShared = sharedCount(self.interests, other.interests);
  const interestMax = Math.max(
    self.interests.length,
    other.interests.length,
    1,
  );
  const interestPts = Math.round((interestShared / interestMax) * 40);

  const vibeShared = sharedCount(self.vibes, other.vibes);
  const vibePts = Math.min(15, vibeShared * 5);

  const lookingPts =
    self.lookingFor && other.lookingFor && self.lookingFor === other.lookingFor
      ? 8
      : 0;

  const promptBonus = Math.min(
    10,
    Math.floor(((self.prompts?.length ?? 0) + (other.prompts?.length ?? 0)) / 2) *
      3,
  );

  const boost = pairBoost(self.id, other.id);
  const raw = interestPts + vibePts + lookingPts + promptBonus + boost + 12;
  return Math.min(99, Math.max(12, raw));
}

/**
 * Walk-by display score: profile compatibility gated by proximity band.
 * band 0 = far, 1 = mid, 2 = near (from firmware RSSI / phone estimate).
 */
export function walkByScore(
  self: UserProfile,
  other: UserProfile,
  proximityBand: 0 | 1 | 2,
): number {
  const base = compatibilityScore(self, other);
  const gate = proximityBand === 0 ? 0.45 : proximityBand === 1 ? 0.75 : 1;
  return Math.min(99, Math.max(8, Math.round(base * gate)));
}

export function vibeCaption(otherName: string, score: number): string {
  if (score >= 75) return `You and ${otherName} have great vibes in common`;
  if (score >= 55) return `You and ${otherName} share solid energy nearby`;
  if (score >= 35) return `You and ${otherName} have a few sparks overlapping`;
  return `You and ${otherName} could click with a little time`;
}

/** Parse NB-A1B2 local name / short id into uppercase hex nibble. */
export function normalizeDeviceId(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  const withPrefix = trimmed.match(/^NB-([0-9A-F]{4})$/);
  if (withPrefix) return withPrefix[1];
  if (/^[0-9A-F]{4}$/.test(trimmed)) return trimmed;
  return null;
}

export function mockFacilitate(
  self: UserProfile,
  other: UserProfile,
): FacilitateResponse {
  const sharedInterests = self.interests.filter((i) =>
    other.interests.includes(i),
  );
  const sharedVibes = (self.vibes ?? []).filter((v) =>
    (other.vibes ?? []).includes(v),
  );

  const hook =
    sharedInterests[0] ??
    sharedVibes[0] ??
    other.lookingFor ??
    other.interests[0] ??
    "being nearby";

  const whyYouVibe =
    sharedInterests.length > 0
      ? `You both light up around ${sharedInterests.slice(0, 2).join(" and ")} — easy opener if you cross paths.`
      : `${other.name}'s into ${hook}. You've got enough overlap to make a short hello feel natural.`;

  const icebreakers = [
    sharedInterests[0]
      ? `Hey — saw we both like ${sharedInterests[0]}. Got a favorite spot for that around here?`
      : `Hey ${other.name} — what's been the best part of your day so far?`,
    other.prompts?.[0]?.answer
      ? `You wrote about “${other.prompts[0].question.replace(/…$/, "")}” — curious what that looks like for you.`
      : other.bio
        ? `Your bio stuck with me — ${other.bio.slice(0, 60)}${other.bio.length > 60 ? "…" : ""} Want to swap a quick story?`
        : `If we had 10 minutes nearby, what would be a fun mini-adventure?`,
    other.lookingFor
      ? `You're open to ${other.lookingFor.toLowerCase()} — same wavelength. Want to compare notes?`
      : `Coffee or a short walk — which feels more you right now?`,
  ];

  return { whyYouVibe, icebreakers, mode: "mock" };
}

export const SEED_PROFILES: Omit<UserProfile, "createdAt" | "updatedAt">[] = [
  {
    id: "seed-maya",
    email: "maya@nearby.demo",
    name: "Maya",
    age: 27,
    role: "Product designer",
    interests: ["Coffee walks", "Indie film", "Climbing"],
    avatarHue: 168,
    initials: "M",
    photoUrl: null,
    bio: "Designing calm interfaces. Always down for a slow coffee walk.",
    lookingFor: "New friends",
    vibes: ["Chill", "Curious"],
    prompts: [
      {
        id: "p1",
        question: "A perfect Saturday nearby looks like…",
        answer: "Farmers market, then a trail with a thermos.",
      },
    ],
    deviceId: "A1B2",
  },
  {
    id: "seed-jordan",
    email: "jordan@nearby.demo",
    name: "Jordan",
    age: 29,
    role: "Software engineer",
    interests: ["Basketball", "Synthwave", "Dogs"],
    avatarHue: 12,
    initials: "J",
    photoUrl: null,
    bio: "Building things, walking dogs, collecting synth playlists.",
    lookingFor: "Activity buddies",
    vibes: ["Outgoing", "Adventurous"],
    prompts: [
      {
        id: "p1",
        question: "Ask me about…",
        answer: "Pickup basketball spots that aren't slammed.",
      },
    ],
    deviceId: "C3D4",
  },
  {
    id: "seed-sam",
    email: "sam@nearby.demo",
    name: "Sam",
    age: 24,
    role: "Grad student",
    interests: ["Farmers markets", "Pottery", "Jazz"],
    avatarHue: 220,
    initials: "S",
    photoUrl: null,
    bio: "Clay under my nails more often than I'd admit.",
    lookingFor: "Creative collabs",
    vibes: ["Thoughtful", "Low-key"],
    prompts: [
      {
        id: "p1",
        question: "I'm unusually good at…",
        answer: "Remembering every jazz record shop in a new city.",
      },
    ],
    deviceId: "E5F6",
  },
  {
    id: "seed-alex",
    email: "alex@nearby.demo",
    name: "Alex",
    age: 31,
    role: "Community organizer",
    interests: ["Running", "Board games", "Thai food"],
    avatarHue: 280,
    initials: "A",
    photoUrl: null,
    bio: "I throw low-pressure hangouts and somehow they stick.",
    lookingFor: "New friends",
    vibes: ["Outgoing", "Thoughtful"],
    prompts: [
      {
        id: "p1",
        question: "I'm looking for people who…",
        answer: "Show up once and then keep the thread going.",
      },
    ],
    deviceId: "7890",
  },
];
