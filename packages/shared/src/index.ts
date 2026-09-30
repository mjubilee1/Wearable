export type UserProfile = {
  id: string;
  email: string;
  name: string;
  age: number;
  role: string;
  interests: string[];
  avatarHue: number;
  initials: string;
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
};

export type UpdateUserInput = Partial<
  Pick<UserProfile, "name" | "age" | "role" | "interests">
>;

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

export function compatibilityScore(
  self: UserProfile,
  other: UserProfile,
): number {
  const shared = self.interests.filter((interest) =>
    other.interests.includes(interest),
  ).length;
  const max = Math.max(self.interests.length, other.interests.length, 1);
  const overlap = Math.round((shared / max) * 55);
  const boost = pairBoost(self.id, other.id);
  return Math.min(99, Math.max(12, overlap + boost + 18));
}

export function vibeCaption(otherName: string, score: number): string {
  if (score >= 75) return `You and ${otherName} have great vibes in common`;
  if (score >= 55) return `You and ${otherName} share solid energy nearby`;
  if (score >= 35) return `You and ${otherName} have a few sparks overlapping`;
  return `You and ${otherName} could click with a little time`;
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
  },
];
