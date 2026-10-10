export type ProfilePrompt = {
  id: string;
  question: string;
  answer: string;
};

/** Paid plan tier. Hardware is separate; this is the recurring SaaS layer. */
export type PlanTier = "free" | "plus";

export type SubscriptionStatus =
  | "none"
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";

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
  /** SaaS plan — only the API/webhooks may write this. */
  plan?: PlanTier;
  subscriptionStatus?: SubscriptionStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  planUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
};

/** Active Nearby+ (or trialing). */
export function isNearbyPlus(profile: Pick<UserProfile, "plan" | "subscriptionStatus">): boolean {
  if (profile.plan !== "plus") return false;
  const status = profile.subscriptionStatus ?? "none";
  return status === "active" || status === "trialing";
}

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

export const INTEREST_OPTIONS = [
  "Coffee walks",
  "Indie film",
  "Climbing",
  "Basketball",
  "Synthwave",
  "Dogs",
  "Farmers markets",
  "Pottery",
  "Jazz",
  "Running",
  "Board games",
  "Thai food",
] as const;

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

/**
 * Stage-1 manufacturer payload (company id already included by SoftDevice):
 *   [0xFF, 0xFF, 'N', 'B', id0, id1, id2, id3]
 */
export const NEARBY_MFG_COMPANY_ID_LE = [0xff, 0xff] as const;
export const NEARBY_MFG_MAGIC = [0x4e, 0x42] as const; // 'N' 'B'

/** RSSI at/above this = "close enough" for walk-by green evaluation. */
export const CLIP_RSSI_CLOSE_DBM = -60;

/** Phone-side EMA for RSSI before POST. */
export const CLIP_RSSI_EMA_ALPHA = 0.25;

/**
 * GATT LED service on clip-phone-led firmware.
 * Phone writes color to the wearer's own linked clip only.
 */
export const NEARBY_LED_SERVICE_UUID =
  "4e420001-0000-1000-8000-00805f9b34fb";
export const NEARBY_LED_COLOR_CHAR_UUID =
  "4e420002-0000-1000-8000-00805f9b34fb";

/** Color characteristic payload (1 byte). */
export const CLIP_LED_OFF = 0;
export const CLIP_LED_GREEN = 1;

/** Min gap between GATT connect/write cycles to own clip. */
export const CLIP_LED_WRITE_MIN_INTERVAL_MS = 2000;

/** Minimum shared interests (after close) to mark similar/green. */
export const CLIP_MIN_SHARED_INTERESTS = 1;

/** Phone → API sighting body. No names, no interests. */
export type ClipSightingPost = {
  remoteClipId: string;
  rssi: number;
  timestamp: number;
};

/** Debug / client view of a stored sighting. No names. */
export type ClipSightingView = {
  remoteClipId: string;
  rssi: number;
  timestamp: number;
  close: boolean;
  /** true only when close AND interest-similar; otherwise false. */
  green: boolean;
};

/** Parse manufacturer bytes → 8-char uppercase hex clip id, or null. */
export function clipIdFromManufacturerBytes(bytes: Uint8Array | number[]): string | null {
  if (bytes.length < 8) return null;
  if (bytes[0] !== NEARBY_MFG_COMPANY_ID_LE[0]) return null;
  if (bytes[1] !== NEARBY_MFG_COMPANY_ID_LE[1]) return null;
  if (bytes[2] !== NEARBY_MFG_MAGIC[0] || bytes[3] !== NEARBY_MFG_MAGIC[1]) {
    return null;
  }
  return [bytes[4], bytes[5], bytes[6], bytes[7]]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Normalize a clip / device id.
 * Accepts 8-char full id, 4-char short (NB-XXXX / legacy profile), or NB-XXXX.
 */
export function normalizeDeviceId(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  const withPrefix = trimmed.match(/^NB-([0-9A-F]{4})$/);
  if (withPrefix) return withPrefix[1];
  if (/^[0-9A-F]{8}$/.test(trimmed)) return trimmed;
  if (/^[0-9A-F]{4}$/.test(trimmed)) return trimmed;
  return null;
}

/** True when two ids refer to the same clip (full 8 vs short last-4). */
export function clipsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeDeviceId(String(a ?? ""));
  const right = normalizeDeviceId(String(b ?? ""));
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length === 8 && right.length === 4) return left.endsWith(right);
  if (left.length === 4 && right.length === 8) return right.endsWith(left);
  return false;
}

export function isClipCloseEnough(rssi: number): boolean {
  return rssi >= CLIP_RSSI_CLOSE_DBM;
}

export function sharedInterestCount(
  a: string[] | undefined,
  b: string[] | undefined,
): number {
  return sharedCount(a, b);
}

export function isInterestSimilarEnough(
  selfInterests: string[] | undefined,
  otherInterests: string[] | undefined,
): boolean {
  return sharedInterestCount(selfInterests, otherInterests) >= CLIP_MIN_SHARED_INTERESTS;
}

/** Green = close enough AND similar enough. Never exposes names. */
export function walkBySignal(input: {
  rssi: number;
  selfInterests?: string[];
  otherInterests?: string[] | null;
}): { close: boolean; green: boolean } {
  const close = isClipCloseEnough(input.rssi);
  if (!close || !input.otherInterests) {
    return { close, green: false };
  }
  const green = isInterestSimilarEnough(input.selfInterests, input.otherInterests);
  return { close, green };
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
