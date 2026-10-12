export type ProfilePrompt = {
  id: string;
  question: string;
  answer: string;
};

/**
 * Paid plan tier. Hardware is separate; this is the recurring SaaS layer.
 * `pro` / `plus` are legacy. Checkout writes pro_monthly, pro_annual, or team.
 * `team_member` is seat access through a team owner's subscription.
 */
export type PlanTier =
  | "free"
  | "pro"
  | "pro_monthly"
  | "pro_annual"
  | "team"
  | "team_member";

/** Legacy Firestore value from the Nearby+ spike. Read as Pro. */
export type StoredPlanTier = PlanTier | "plus";

export type BillingInterval = "month" | "year";

/** Checkout plan picker keys (map to Stripe price lookup_keys). */
export type CheckoutPlan = "pro_monthly" | "pro_annual" | "team";

export type SubscriptionStatus =
  | "none"
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";

export const PRO_MONTHLY_USD = 29;
export const PRO_YEARLY_USD = 249;
/** @deprecated Use PRO_YEARLY_USD. Old Stripe yearly price was $290. */
export const PRO_YEARLY_USD_LEGACY = 290;
export const TEAM_MONTHLY_USD = 199;
export const TEAM_SEATS = 10;
/** Owner takes one seat; up to 9 invitees. */
export const TEAM_INVITE_LIMIT = 9;
export const PRO_TRIAL_DAYS = 7;
/** Rough savings vs 12 × monthly. */
export const PRO_ANNUAL_SAVE_PERCENT = 28;
export const FREE_DAILY_REQUESTS = 20;
export const FREE_DAILY_RESCHEDULES = 3;
export const FREE_DAILY_DRAFTS = 3;

export const STRIPE_LOOKUP_PRO_MONTHLY = "pro_monthly";
export const STRIPE_LOOKUP_PRO_ANNUAL = "pro_annual";
export const STRIPE_LOOKUP_TEAM_MONTHLY = "team_monthly";
export const FOUNDING_PROMO_CODE = "FOUNDING19";

export type LimitFeature = "requests" | "reschedule" | "draft_email";

export type LimitReachedBody = {
  code: "limit_reached";
  feature: LimitFeature;
  resetAt: string;
};

export function normalizePlan(plan: unknown): PlanTier {
  if (
    plan === "pro_monthly" ||
    plan === "pro_annual" ||
    plan === "team" ||
    plan === "team_member"
  ) {
    return plan;
  }
  if (plan === "pro" || plan === "plus") return "pro";
  return "free";
}

export function isPaidPlan(plan: unknown): boolean {
  return normalizePlan(plan) !== "free";
}

/** Checkout plan → Stripe price lookup_key. */
export function lookupKeyForCheckoutPlan(plan: CheckoutPlan): string {
  if (plan === "pro_annual") return STRIPE_LOOKUP_PRO_ANNUAL;
  if (plan === "team") return STRIPE_LOOKUP_TEAM_MONTHLY;
  return STRIPE_LOOKUP_PRO_MONTHLY;
}

export function checkoutPlanFromInterval(
  interval: BillingInterval,
): CheckoutPlan {
  return interval === "year" ? "pro_annual" : "pro_monthly";
}

/** Pro, trial, team seat, or a failed payment still inside the paid period. */
export function hasProAccess(profile: {
  plan?: string | null;
  subscriptionStatus?: string | null;
}): boolean {
  const status = profile.subscriptionStatus ?? "none";
  if (status !== "active" && status !== "trialing" && status !== "past_due") {
    return false;
  }
  return isPaidPlan(profile.plan);
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

export function limitReachedMessage(feature: LimitFeature): string {
  if (feature === "reschedule") {
    return "You've used today's free reschedules. Pro does unlimited for $29/mo, free for 7 days.";
  }
  if (feature === "draft_email") {
    return "You've used today's free email drafts. Pro does unlimited for $29/mo, free for 7 days.";
  }
  return "You've used today's 20 free requests. Pro does unlimited for $29/mo, free for 7 days.";
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
  /** Promotion code applied at checkout (e.g. FOUNDING19). */
  promoCode?: string | null;
  /** Team seat count when plan is team (owner). */
  seats?: number | null;
  /** Invited member emails (owner). Lowercased. */
  teamMemberEmails?: string[];
  /** Team owner uid when this user is on a seat. */
  teamOwnerId?: string | null;
  /** Short code for /r/<code> referral links. */
  referralCode?: string | null;
  /** Successful referral conversions (trial → paid). */
  referralCount?: number;
  /** Referrer's referralCode captured at signup. */
  referredBy?: string | null;
  /** First-touch campaign params saved at signup. */
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  /** Set when the connector welcome modal is dismissed. */
  connectorSetupDismissedAt?: number | null;
  /** IANA timezone from the browser (e.g. America/New_York). */
  timeZone?: string | null;
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
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export function isAgentToolName(value: string): value is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(value);
}

/** One spoken turn. A tool the model selects runs in this same request. */
export type AgentTurnRequest = {
  text?: string;
  /** Browser IANA timezone for today/tomorrow and wall-clock times. */
  timeZone?: string;
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
  /** Preview that was cancelled — not a separate Cancel turn. */
  status?: "cancelled" | null;
};

export type AgentFeatureUsage = {
  limit: number | null;
  used: number;
  remaining: number | null;
};

export type AgentUsageStatus = {
  plan: "free" | "pro";
  /** Free daily request cap; null when unlimited (Pro). */
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

/** A fact the user asked to keep. */
export type AgentMemoryItem = {
  id: string;
  text: string;
  createdAt: number;
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
