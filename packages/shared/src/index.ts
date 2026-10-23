export type ProfilePrompt = {
  id: string;
  question: string;
  answer: string;
};

/** Paid plan tier. Hardware is separate; this is the recurring SaaS layer. */
export type PlanTier = "free" | "pro";

/** Legacy Firestore value from the Nearby+ spike. Read as Pro. */
export type StoredPlanTier = PlanTier | "plus";

export type BillingInterval = "month" | "year";

export type SubscriptionStatus =
  | "none"
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";

export type PhoneNumberType = "PERSONAL" | "NEARBY_ASSIGNED";
export type PhoneProvisioningStatus =
  | "NONE"
  | "VERIFYING"
  | "PROCESSING"
  | "ACTIVE"
  | "FAILED";

export const PRO_MONTHLY_USD = 29;
export const PRO_YEARLY_USD = 249;
export const PRO_TRIAL_DAYS = 7;
export const FREE_DAILY_REQUESTS = 20;
export const VOICE_MEMO_MONTHLY_MINUTES = 300;
export const VOICE_MEMO_MAX_SECONDS = 5 * 60;
export const FREE_MEMORY_RETENTION_DAYS = 7;
export const DEMO_TRY_LIMIT = 3;

export type LimitFeature = "requests" | "reschedule" | "draft_email";

export type LimitReachedBody = {
  code: "limit_reached";
  feature: LimitFeature;
  resetAt: string;
};

export function normalizePlan(plan: unknown): PlanTier {
  return plan === "pro" || plan === "plus" ? "pro" : "free";
}

/** Pro, trial, or a failed payment still inside the paid period. */
export function hasProAccess(profile: {
  plan?: string | null;
  subscriptionStatus?: string | null;
}): boolean {
  const status = profile.subscriptionStatus ?? "none";
  if (status !== "active" && status !== "trialing" && status !== "past_due") {
    return false;
  }
  return normalizePlan(profile.plan) === "pro";
}

export function isLimitReachedBody(value: unknown): value is LimitReachedBody {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.code === "limit_reached" &&
    (row.feature === "requests" ||
      row.feature === "reschedule" ||
      row.feature === "draft_email") &&
    typeof row.resetAt === "string"
  );
}

export function limitReachedMessage(_feature: LimitFeature): string {
  return `You've used today's ${FREE_DAILY_REQUESTS} free requests. Pro does unlimited for $29/mo, free for 7 days.`;
}

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
  /** Pendant code from the Bluetooth name Nearby AB12. */
  pendantId?: string | null;
  /** SaaS plan — only the API/webhooks may write this. */
  plan?: PlanTier;
  subscriptionStatus?: SubscriptionStatus;
  stripeCustomerId?: string | null;
  /** Stripe customer for test mode. Kept apart from live so a mode switch cannot 404. */
  stripeCustomerIdTest?: string | null;
  /** Stripe customer for live mode. */
  stripeCustomerIdLive?: string | null;
  stripeSubscriptionId?: string | null;
  planUpdatedAt?: number;
  /** Unix ms. Set while the Stripe subscription is trialing. */
  trialEndsAt?: number | null;
  /** Unix ms. End of the current paid period. */
  currentPeriodEnd?: number | null;
  cancelAtPeriodEnd?: boolean;
  billingInterval?: BillingInterval | null;
  /** Unix ms of the last failed invoice. Cleared when payment succeeds. */
  paymentFailedAt?: number | null;
  /** Promotion code applied to the current subscription, when any. */
  promoCode?: string | null;
  /** Shareable code for Pro referrals. Assigned by the API. */
  referralCode?: string | null;
  /** Referral code captured before this user checked out. */
  referredByCode?: string | null;
  /** Number of referred trials that have converted to paid. */
  referralCount?: number;
  /** First-touch campaign params saved at signup. */
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  /** Set when the connector welcome modal is dismissed. */
  connectorSetupDismissedAt?: number | null;
  /** IANA timezone from the browser (e.g. America/New_York). */
  timeZone?: string | null;
  /** Private account data. APIs must never include this on public profiles. */
  phoneNumber?: string | null;
  phoneNumberType?: PhoneNumberType | null;
  phoneVerified?: boolean;
  twilioPhoneNumberSid?: string | null;
  phoneProvisioningStatus?: PhoneProvisioningStatus;
  phoneCreatedAt?: number | null;
  /** New accounts remain in phone onboarding until the server completes setup. */
  phoneOnboardingRequired?: boolean;
  createdAt: number;
  updatedAt: number;
};

/** Active Pro (or trialing / past due). Nearby+ is the old name for Pro. */
export function isNearbyPlus(profile: {
  plan?: string | null;
  subscriptionStatus?: string | null;
}): boolean {
  return hasProAccess(profile);
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
    | "pendantId"
    | "connectorSetupDismissedAt"
    | "timeZone"
  >
>;

/** True when a profile name is missing or is an email address. */
export function isEmailLikeName(name: string, email?: string | null): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (trimmed.includes("@")) return true;
  const mail = email?.trim().toLowerCase();
  if (mail && trimmed.toLowerCase() === mail) return true;
  return false;
}

/** First token of a real name, or null when the stored name is an email. */
export function firstNameFrom(name: string, email?: string | null): string | null {
  if (isEmailLikeName(name, email)) return null;
  const first = name.trim().split(/\s+/)[0];
  return first || null;
}

export {
  INVITE_STORAGE_KEY,
  inviteCodeFromPath,
  inviteJoinMessage,
  isInviteCode,
} from "./invite.js";

export * from "./spatial.js";
export * from "./spatial-intelligence.js";
export * from "./discovery.js";
export * from "./observation-network.js";
export * from "./auth-errors.js";

export {
  applyNationalPhoneInput,
  DEFAULT_PHONE_COUNTRY,
  listPhoneCountries,
  phonePlaceholder,
  toE164Phone,
  type PhoneCountry,
  type PhoneCountryCode,
} from "./phone.js";

/** Where the verification email returns the person after they confirm. */
export const EMAIL_VERIFICATION_CONTINUE_URL = "https://nearbyhello.com/app";

/**
 * Password accounts created at or after this instant must verify email.
 * Earlier accounts keep working without a verification email.
 * 10:00 AM US Eastern on Oct 15, 2026.
 */
export const EMAIL_VERIFICATION_REQUIRED_AFTER_MS = Date.UTC(2026, 9, 15, 14, 0, 0);

export const JUNK_EMAIL_MESSAGE = "Please use your regular email address";

/** Gmail addresses with 3 or more dots in the local part are signup junk. */
export function isDottedJunkEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@")) return false;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (domain !== "gmail.com" && domain !== "googlemail.com") return false;
  let dots = 0;
  for (const char of local) {
    if (char === ".") dots += 1;
  }
  return dots >= 3;
}

/** Password sign-in must verify. Google sign-in and older accounts do not. */
export function passwordUserNeedsEmailVerification(input: {
  emailVerified: boolean;
  providerId: string | null;
  createdAtMs: number;
}): boolean {
  if (input.emailVerified) return false;
  if (input.providerId === "google.com") return false;
  if (input.providerId !== "password") return false;
  return input.createdAtMs >= EMAIL_VERIFICATION_REQUIRED_AFTER_MS;
}

/** Same rule from a Firebase user: Google wins if that provider is linked. */
export function clientNeedsEmailVerification(input: {
  emailVerified: boolean;
  providerIds: string[];
  createdAtMs: number;
}): boolean {
  if (input.providerIds.includes("google.com")) return false;
  const providerId = input.providerIds.includes("password")
    ? "password"
    : (input.providerIds[0] ?? null);
  return passwordUserNeedsEmailVerification({
    emailVerified: input.emailVerified,
    providerId,
    createdAtMs: input.createdAtMs,
  });
}

/** Seed copy that should never appear in the notes list. */
export function isPlaceholderNote(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[.!?]+$/g, "");
  return normalized === "add a note" || normalized === "add a new doctor's note";
}

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

export type MessageType = "TEXT";
export type MessageDeliveryStatus = "SENT" | "DELIVERED";

export type Conversation = {
  id: string;
  participants: [string, string];
  createdAt: number;
  updatedAt: number;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  messageType: MessageType;
  deliveryStatus: MessageDeliveryStatus;
  createdAt: number;
};

export type ConversationSummary = Conversation & {
  other: PublicProfilePreview;
  lastMessage: Pick<Message, "content" | "senderId" | "createdAt"> | null;
};

export const MESSAGE_MAX_LENGTH = 2_000;

const MESSAGE_CLUSTER_GAP_MS = 5 * 60 * 1000;

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayDistance(timestamp: number, now: number): number {
  return Math.round((startOfLocalDay(now) - startOfLocalDay(timestamp)) / 86_400_000);
}

/** Day chip inside a thread: Today, Yesterday, a weekday, or a short date. */
export function messageDayLabel(timestamp: number, now = Date.now()): string {
  const diff = dayDistance(timestamp, now);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) {
    return new Date(timestamp).toLocaleDateString(undefined, { weekday: "long" });
  }
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Compact time for an inbox row. */
export function messageListTime(timestamp: number, now = Date.now()): string {
  const diff = dayDistance(timestamp, now);
  if (diff === 0) {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) {
    return new Date(timestamp).toLocaleDateString(undefined, { weekday: "short" });
  }
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function messageClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export type MessageCluster<T> = {
  senderId: string;
  messages: T[];
};

export type MessageDayGroup<T> = {
  day: string;
  clusters: MessageCluster<T>[];
};

/** Group a thread the way a typical chat does: by day, then by sender bursts. */
export function groupChatMessages<T extends { createdAt: number; senderId: string }>(
  messages: T[],
  now = Date.now(),
): MessageDayGroup<T>[] {
  const groups: MessageDayGroup<T>[] = [];
  for (const message of messages) {
    const day = messageDayLabel(message.createdAt, now);
    let group = groups.at(-1);
    if (!group || group.day !== day) {
      group = { day, clusters: [] };
      groups.push(group);
    }
    const cluster = group.clusters.at(-1);
    const previous = cluster?.messages.at(-1);
    if (
      cluster &&
      cluster.senderId === message.senderId &&
      previous &&
      message.createdAt - previous.createdAt < MESSAGE_CLUSTER_GAP_MS
    ) {
      cluster.messages.push(message);
    } else {
      group.clusters.push({ senderId: message.senderId, messages: [message] });
    }
  }
  return groups;
}

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

/** Nearby list, before both people say hello. No name. */
export function nearbyCaption(score: number): string {
  if (score >= 75) return "Strong overlap nearby";
  if (score >= 55) return "Solid overlap nearby";
  if (score >= 35) return "A little overlap nearby";
  return "Someone is nearby";
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
/** Bluetooth local name is `Nearby` plus this code, for example `Nearby AB12`. */
export function pendantCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const match = name.trim().match(/^Nearby ([0-9A-Fa-f]{4})$/);
  return match ? match[1].toUpperCase() : null;
}

export function pendantDisplayName(code: string): string {
  return `Nearby ${code.trim().toUpperCase()}`;
}

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

export const AGENT_TOOL_NAMES = [
  "calendar",
  "gmail",
  "note",
  "reminder",
  "remember",
  "reschedule",
  "draft_email",
  "web_search",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export function isAgentToolName(value: string): value is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(value);
}

/** One GPS fix for a turn about weather, nearby places, or directions. */
export type DeviceLocation = {
  latitude: number;
  longitude: number;
};

export function isDeviceLocation(value: unknown): value is DeviceLocation {
  if (!value || typeof value !== "object") return false;
  const latitude = (value as DeviceLocation).latitude;
  const longitude = (value as DeviceLocation).longitude;
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * True when the spoken or typed turn is about where the user is.
 * A named place ("weather in Washington DC") does not need GPS.
 */
export function turnNeedsDeviceLocation(text: string): boolean {
  const clean = text.trim();
  if (!clean || /^(?:hey |hello |ok |okay )?nearby[.!?\s]*$/i.test(clean)) {
    return false;
  }
  const lower = clean.toLowerCase();
  if (
    /\b(where am i|where i am|my location|current location)\b/.test(lower) ||
    /\b(near me|around here|around me|close to me|in this area)\b/.test(lower) ||
    /\bnearby\b/.test(lower) ||
    /\b(nearest|closest)\b/.test(lower) ||
    /\b(directions|how far|how long to get)\b/.test(lower) ||
    /\btraffic\b/.test(lower)
  ) {
    return true;
  }
  if (!/\b(weather|forecast|temperature)\b/.test(lower)) return false;
  return !/\b(?:in|for|at)\s+[a-z]/i.test(lower);
}

export const DEVICE_LOCATION_OFF =
  "Location is off, so this answer won't use where you are.";

/** One spoken turn. A tool the model selects runs in this same request. */
export type AgentTurnRequest = {
  text?: string;
  /** Browser IANA timezone for today/tomorrow and wall-clock times. */
  timeZone?: string;
  /** Present only when this turn needs where the user is. */
  location?: DeviceLocation;
  decision?: {
    tool: AgentToolName;
    approved: boolean;
    summary: string;
    payload: Record<string, string>;
    /** When cancelling a preview, mark this history row instead of adding a turn. */
    historyId?: string;
  };
  /** User picked one of several matching email threads. */
  draftPick?: {
    messageId: string;
    threadId: string;
    intent: string;
    query: string;
  };
};

export type AgentPendingTool = {
  tool: AgentToolName;
  summary: string;
  payload: Record<string, string>;
};

/** A completed tool action the client can show and link. */
export type AgentActionReceipt = {
  /** Short past-tense phrase shown after "Done:". */
  action: string;
  /** HTTPS link to the event, task, or email that was created or read. */
  href: string | null;
  linkLabel: string | null;
};

/** Confirm-first calendar move preview. Nothing is written until Confirm. */
export type AgentReschedulePreview = {
  kind: "reschedule";
  eventId: string;
  calendarId: string;
  title: string;
  oldWhen: string;
  newWhen: string;
  htmlLink: string | null;
};

/** Confirm-first Gmail draft preview. Never sends. */
export type AgentDraftPreview = {
  kind: "draft_email";
  threadId: string;
  messageId: string;
  to: string;
  subject: string;
  body: string;
};

/** Several matching threads — user must pick before a draft is built. */
export type AgentDraftChoicesPreview = {
  kind: "draft_choices";
  query: string;
  intent: string;
  choices: Array<{
    messageId: string;
    threadId: string;
    to: string;
    label: string;
  }>;
};

export type AgentConfirmPreview =
  | AgentReschedulePreview
  | AgentDraftPreview
  | AgentDraftChoicesPreview;

/** One Talk turn kept in Recent history (newest 20). */
export type AgentHistoryItem = {
  id: string;
  request: string;
  reply: string;
  receipt: AgentActionReceipt | null;
  createdAt: number;
  /** Preview that was cancelled, or a confirm that already spent its request. */
  status?: "cancelled" | "confirmed" | null;
};

export type AgentFeatureUsage = {
  limit: number | null;
  used: number;
  remaining: number | null;
};

export type AgentUsageStatus = {
  plan: "free" | "pro";
  /** Free daily request cap; null when unlimited (Pro). Reschedules and drafts spend this same pool. */
  limit: number | null;
  used: number;
  remaining: number | null;
  reschedules?: AgentFeatureUsage;
  drafts?: AgentFeatureUsage;
  /** ISO time when free counters reset (next midnight in the user timezone). */
  resetAt?: string;
};

export type AgentTurnResponse = {
  reply: string;
  pendingTool: AgentPendingTool | null;
  mode: "openai" | "mock";
  receipt?: AgentActionReceipt | null;
  /** Confirm-first preview card; Cancel leaves Google untouched. */
  preview?: AgentConfirmPreview | null;
  usage?: AgentUsageStatus;
  /** History row for this turn — Cancel marks it cancelled instead of adding another. */
  historyId?: string | null;
};

/** A spoken command or voice memo retained for later recall. */
export type AgentMemoryItem = {
  id: string;
  userId: string;
  text: string;
  summary: string;
  people: string[];
  dates: string[];
  createdAt: number;
  source: "command" | "voice_memo" | "remember";
};

export const VOICE_MEMO_ACTION_TYPES = [
  "reminder",
  "calendar_event",
  "email_draft",
] as const;

export type VoiceMemoActionType = (typeof VOICE_MEMO_ACTION_TYPES)[number];
export type VoiceMemoActionStatus = "proposed" | "confirmed" | "skipped";

export type VoiceMemoAction = {
  id: string;
  type: VoiceMemoActionType;
  details: Record<string, string>;
  status: VoiceMemoActionStatus;
  receipt?: AgentActionReceipt | null;
};

export type VoiceMemo = {
  id: string;
  transcript: string;
  /** Markdown-style string containing 3–5 short bullet lines. */
  recap: string;
  actions: VoiceMemoAction[];
  createdAt: number;
  durationSeconds: number;
};

export type VoiceMemoUsage = {
  plan: "free" | "pro";
  limitMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  month: string;
  resetAt: string;
};

export type VoiceMemoListResponse = {
  memos: VoiceMemo[];
  usage: VoiceMemoUsage;
};

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
      : `There's enough overlap around ${hook} to make a short hello feel natural.`;

  const icebreakers = [
    sharedInterests[0]
      ? `Hey — saw we both like ${sharedInterests[0]}. Got a favorite spot for that around here?`
      : `Hey — what's been the best part of your day so far?`,
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
