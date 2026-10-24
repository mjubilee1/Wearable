import type { WorkSpot, WorkSpotStatus } from "@nearby/shared";

const KEY = "nearby.work-spot.readings";

type StoredReading = {
  spotId: string;
  loudness: number;
  status: WorkSpotStatus;
  tags: string[];
  savedAt: number;
};

function readAll(): StoredReading[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredReading[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(rows: StoredReading[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(rows));
}

export function saveLocalSpotReading(
  spotId: string,
  input: { loudness: number; status: WorkSpotStatus; tags: string[] },
) {
  const rows = readAll().filter((row) => row.spotId !== spotId);
  rows.push({
    spotId,
    loudness: input.loudness,
    status: input.status,
    tags: input.tags,
    savedAt: Date.now(),
  });
  writeAll(rows);
}

export function applyLocalReadings(spots: WorkSpot[]): WorkSpot[] {
  const rows = readAll();
  return spots.map((spot) => {
    const read = rows.find((row) => row.spotId === spot.id);
    if (!read) return spot;
    const minutes = Math.max(0, Math.round((Date.now() - read.savedAt) / 60_000));
    return {
      ...spot,
      status: read.status,
      statusSource: "community",
      hasLiveReading: true,
      lastReadMinutesAgo: minutes,
      contributorCount: Math.max(spot.contributorCount, 1),
      tags: [...new Set([...spot.tags, ...read.tags])],
    };
  });
}
