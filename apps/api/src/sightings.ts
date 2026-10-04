import {
  clipsMatch,
  normalizeDeviceId,
  walkBySignal,
  type ClipSightingView,
  type UserProfile,
} from "@nearby/shared";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

export type StoredClipSighting = ClipSightingView & {
  id: string;
  reporterUserId: string;
};

const memoryByReporter = new Map<string, StoredClipSighting[]>();
const MAX_PER_USER = 50;

function findProfileByClipId(
  profiles: UserProfile[],
  clipId: string,
): UserProfile | undefined {
  return profiles.find((p) => clipsMatch(p.deviceId, clipId));
}

export async function recordClipSighting(input: {
  reporterUserId: string;
  reporter: UserProfile;
  remoteClipId: string;
  rssi: number;
  timestamp: number;
  allProfiles: UserProfile[];
}): Promise<StoredClipSighting> {
  const remoteClipId = normalizeDeviceId(input.remoteClipId);
  if (!remoteClipId) {
    throw new Error("Invalid remoteClipId");
  }

  // Ignore self-adverts when the reporter has linked this clip.
  if (clipsMatch(input.reporter.deviceId, remoteClipId)) {
    throw new Error("Cannot report your own clip");
  }

  const other = findProfileByClipId(input.allProfiles, remoteClipId);
  const { close, green } = walkBySignal({
    rssi: input.rssi,
    selfInterests: input.reporter.interests,
    otherInterests: other?.interests ?? null,
  });

  const record: StoredClipSighting = {
    id: `${input.reporterUserId}_${remoteClipId}_${input.timestamp}`,
    reporterUserId: input.reporterUserId,
    remoteClipId,
    rssi: input.rssi,
    timestamp: input.timestamp,
    close,
    green,
  };

  if (!isFirebaseConfigured()) {
    const list = memoryByReporter.get(input.reporterUserId) ?? [];
    list.unshift(record);
    memoryByReporter.set(input.reporterUserId, list.slice(0, MAX_PER_USER));
    return record;
  }

  await getFirebaseAdmin()
    .firestore()
    .collection("clipSightings")
    .doc(record.id)
    .set({
      reporterUserId: record.reporterUserId,
      remoteClipId: record.remoteClipId,
      rssi: record.rssi,
      timestamp: record.timestamp,
      close: record.close,
      green: record.green,
      createdAt: Date.now(),
    });

  return record;
}

export async function listClipSightingsForUser(
  reporterUserId: string,
  limit = 40,
): Promise<ClipSightingView[]> {
  if (!isFirebaseConfigured()) {
    return (memoryByReporter.get(reporterUserId) ?? [])
      .slice(0, limit)
      .map(({ remoteClipId, rssi, timestamp, close, green }) => ({
        remoteClipId,
        rssi,
        timestamp,
        close,
        green,
      }));
  }

  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("clipSightings")
    .where("reporterUserId", "==", reporterUserId)
    .orderBy("timestamp", "desc")
    .limit(limit)
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data() ?? {};
    return {
      remoteClipId: String(data.remoteClipId ?? ""),
      rssi: Number(data.rssi ?? 0),
      timestamp: Number(data.timestamp ?? 0),
      close: Boolean(data.close),
      green: Boolean(data.green),
    };
  });
}
