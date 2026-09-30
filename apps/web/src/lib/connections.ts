import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
} from "firebase/firestore";
import {
  DECLINE_COOLDOWN_MS,
  INTRO_MESSAGE_MAX,
  pairIdFor,
  sanitizeIntroMessage,
  toPublicPreview,
  type Connection,
  type ConnectionRequest,
  type ConnectionRequestStatus,
  type PublicProfilePreview,
  type UserBlock,
  type UserProfile,
} from "@nearby/shared";
import { db } from "@/lib/firebase";
import { getUserProfile } from "@/lib/users";

const REQUESTS = "connectionRequests";
const CONNECTIONS = "connections";
const BLOCKS = "blocks";

function mapRequest(id: string, data: DocumentData): ConnectionRequest {
  return {
    id,
    pairId: String(data.pairId ?? ""),
    fromId: String(data.fromId ?? ""),
    toId: String(data.toId ?? ""),
    message: String(data.message ?? ""),
    status: data.status as ConnectionRequestStatus,
    createdAt: Number(data.createdAt ?? Date.now()),
    updatedAt: Number(data.updatedAt ?? Date.now()),
    respondedAt:
      data.respondedAt === undefined || data.respondedAt === null
        ? null
        : Number(data.respondedAt),
  };
}

function mapConnection(id: string, data: DocumentData): Connection {
  const userIds = Array.isArray(data.userIds)
    ? (data.userIds.map(String) as [string, string])
    : (["", ""] as [string, string]);
  return {
    id,
    pairId: String(data.pairId ?? id),
    userIds,
    requestId: String(data.requestId ?? ""),
    createdAt: Number(data.createdAt ?? Date.now()),
  };
}

function mapBlock(id: string, data: DocumentData): UserBlock {
  return {
    id,
    blockerId: String(data.blockerId ?? ""),
    blockedId: String(data.blockedId ?? ""),
    createdAt: Number(data.createdAt ?? Date.now()),
  };
}

export type RequestWithProfile = {
  request: ConnectionRequest;
  other: PublicProfilePreview;
};

async function previewFor(uid: string): Promise<PublicProfilePreview | null> {
  const profile = await getUserProfile(uid);
  return profile ? toPublicPreview(profile) : null;
}

function canResendAfterDecline(request: ConnectionRequest): boolean {
  if (request.status !== "declined") return true;
  const at = request.respondedAt ?? request.updatedAt;
  return Date.now() - at >= DECLINE_COOLDOWN_MS;
}

export async function listBlocksInvolving(uid: string): Promise<UserBlock[]> {
  const [asBlocker, asBlocked] = await Promise.all([
    getDocs(query(collection(db, BLOCKS), where("blockerId", "==", uid))),
    getDocs(query(collection(db, BLOCKS), where("blockedId", "==", uid))),
  ]);

  const byId = new Map<string, UserBlock>();
  for (const snap of [...asBlocker.docs, ...asBlocked.docs]) {
    byId.set(snap.id, mapBlock(snap.id, snap.data()));
  }
  return [...byId.values()];
}

export async function blockedUserIds(uid: string): Promise<Set<string>> {
  const blocks = await listBlocksInvolving(uid);
  const ids = new Set<string>();
  for (const block of blocks) {
    ids.add(block.blockerId === uid ? block.blockedId : block.blockerId);
  }
  return ids;
}

export async function getPairRequest(
  a: string,
  b: string,
): Promise<ConnectionRequest | null> {
  const [fromA, fromB] = await Promise.all([
    getDocs(
      query(
        collection(db, REQUESTS),
        where("fromId", "==", a),
        where("toId", "==", b),
      ),
    ),
    getDocs(
      query(
        collection(db, REQUESTS),
        where("fromId", "==", b),
        where("toId", "==", a),
      ),
    ),
  ]);

  const requests = [...fromA.docs, ...fromB.docs]
    .map((item) => mapRequest(item.id, item.data()))
    .sort((x, y) => y.createdAt - x.createdAt);
  return requests[0] ?? null;
}

export async function sendConnectionRequest(input: {
  from: UserProfile;
  toId: string;
  message: string;
}): Promise<ConnectionRequest> {
  const { from, toId } = input;
  if (from.id === toId) {
    throw new Error("You can’t send a hello to yourself");
  }

  const message = sanitizeIntroMessage(input.message);
  if (!message) {
    throw new Error("Write a short hello before sending");
  }
  if (message.length > INTRO_MESSAGE_MAX) {
    throw new Error(`Keep it under ${INTRO_MESSAGE_MAX} characters`);
  }

  const blocked = await blockedUserIds(from.id);
  if (blocked.has(toId)) {
    throw new Error("You can’t connect with this person");
  }

  const existing = await getPairRequest(from.id, toId);
  if (existing) {
    if (existing.status === "pending") {
      throw new Error("You already have a hello waiting with them");
    }
    if (existing.status === "accepted") {
      throw new Error("You’re already connected");
    }
    if (existing.status === "declined" && !canResendAfterDecline(existing)) {
      throw new Error("Give it some time before saying hello again");
    }
  }

  const now = Date.now();
  const pairId = pairIdFor(from.id, toId);
  const ref = doc(collection(db, REQUESTS));
  const request: ConnectionRequest = {
    id: ref.id,
    pairId,
    fromId: from.id,
    toId,
    message,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    respondedAt: null,
  };

  await setDoc(ref, request);
  return request;
}

export async function acceptConnectionRequest(
  requestId: string,
  actorId: string,
): Promise<Connection> {
  const snap = await getDoc(doc(db, REQUESTS, requestId));
  if (!snap.exists()) throw new Error("Request not found");
  const request = mapRequest(snap.id, snap.data());

  if (request.toId !== actorId) {
    throw new Error("Only the recipient can accept");
  }
  if (request.status !== "pending") {
    throw new Error("This hello is no longer pending");
  }

  const now = Date.now();
  await updateDoc(doc(db, REQUESTS, requestId), {
    status: "accepted",
    updatedAt: now,
    respondedAt: now,
  });

  const pairId = request.pairId;
  const connection: Connection = {
    id: pairId,
    pairId,
    userIds: [request.fromId, request.toId].sort() as [string, string],
    requestId,
    createdAt: now,
  };
  await setDoc(doc(db, CONNECTIONS, pairId), connection);
  return connection;
}

export async function declineConnectionRequest(
  requestId: string,
  actorId: string,
): Promise<void> {
  const snap = await getDoc(doc(db, REQUESTS, requestId));
  if (!snap.exists()) throw new Error("Request not found");
  const request = mapRequest(snap.id, snap.data());

  if (request.toId !== actorId) {
    throw new Error("Only the recipient can decline");
  }
  if (request.status !== "pending") {
    throw new Error("This hello is no longer pending");
  }

  const now = Date.now();
  // Quiet decline: sender is not notified; UI still shows waiting.
  await updateDoc(doc(db, REQUESTS, requestId), {
    status: "declined",
    updatedAt: now,
    respondedAt: now,
  });
}

export async function cancelConnectionRequest(
  requestId: string,
  actorId: string,
): Promise<void> {
  const snap = await getDoc(doc(db, REQUESTS, requestId));
  if (!snap.exists()) throw new Error("Request not found");
  const request = mapRequest(snap.id, snap.data());

  if (request.fromId !== actorId) {
    throw new Error("Only the sender can cancel");
  }
  if (request.status !== "pending") {
    throw new Error("This hello is no longer pending");
  }

  const now = Date.now();
  await updateDoc(doc(db, REQUESTS, requestId), {
    status: "cancelled",
    updatedAt: now,
    respondedAt: now,
  });
}

export async function blockUser(
  blockerId: string,
  blockedId: string,
): Promise<UserBlock> {
  if (blockerId === blockedId) {
    throw new Error("You can’t block yourself");
  }

  const now = Date.now();
  const id = `${blockerId}_${blockedId}`;
  const block: UserBlock = {
    id,
    blockerId,
    blockedId,
    createdAt: now,
  };
  await setDoc(doc(db, BLOCKS, id), block);

  const pending = await getPairRequest(blockerId, blockedId);
  if (pending?.status === "pending") {
    await updateDoc(doc(db, REQUESTS, pending.id), {
      status: "cancelled",
      updatedAt: now,
      respondedAt: now,
    });
  }

  return block;
}

async function attachOther(
  requests: ConnectionRequest[],
  selfId: string,
): Promise<RequestWithProfile[]> {
  const rows: RequestWithProfile[] = [];
  for (const request of requests) {
    const otherId = request.fromId === selfId ? request.toId : request.fromId;
    const other = await previewFor(otherId);
    if (!other) continue;
    rows.push({ request, other });
  }
  return rows;
}

export async function listIncomingRequests(
  selfId: string,
): Promise<RequestWithProfile[]> {
  const snap = await getDocs(
    query(
      collection(db, REQUESTS),
      where("toId", "==", selfId),
      where("status", "==", "pending"),
    ),
  );
  const requests = snap.docs
    .map((item) => mapRequest(item.id, item.data()))
    .sort((a, b) => b.createdAt - a.createdAt);
  return attachOther(requests, selfId);
}

export async function listOutgoingRequests(
  selfId: string,
): Promise<RequestWithProfile[]> {
  const snap = await getDocs(
    query(collection(db, REQUESTS), where("fromId", "==", selfId)),
  );
  const latestByPair = new Map<string, ConnectionRequest>();
  for (const item of snap.docs) {
    const request = mapRequest(item.id, item.data());
    const prev = latestByPair.get(request.pairId);
    if (!prev || request.createdAt > prev.createdAt) {
      latestByPair.set(request.pairId, request);
    }
  }

  const requests = [...latestByPair.values()]
    .filter((r) => {
      if (r.status === "pending") return true;
      // Quiet decline: keep showing as waiting until cooldown ends.
      if (r.status === "declined" && !canResendAfterDecline(r)) return true;
      return false;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  return attachOther(requests, selfId);
}

export async function listConnections(
  selfId: string,
): Promise<RequestWithProfile[]> {
  const snap = await getDocs(
    query(
      collection(db, CONNECTIONS),
      where("userIds", "array-contains", selfId),
    ),
  );
  const mine = snap.docs
    .map((item) => mapConnection(item.id, item.data()))
    .sort((a, b) => b.createdAt - a.createdAt);

  const rows: RequestWithProfile[] = [];
  for (const connection of mine) {
    const otherId =
      connection.userIds[0] === selfId
        ? connection.userIds[1]
        : connection.userIds[0];
    const other = await previewFor(otherId);
    if (!other) continue;
    rows.push({
      request: {
        id: connection.requestId,
        pairId: connection.pairId,
        fromId: connection.userIds[0],
        toId: connection.userIds[1],
        message: "",
        status: "accepted",
        createdAt: connection.createdAt,
        updatedAt: connection.createdAt,
        respondedAt: connection.createdAt,
      },
      other,
    });
  }
  return rows;
}

export async function connectionStatusMap(
  selfId: string,
  otherIds: string[],
): Promise<Map<string, ConnectionRequestStatus | "none">> {
  const map = new Map<string, ConnectionRequestStatus | "none">();
  for (const id of otherIds) map.set(id, "none");
  if (otherIds.length === 0) return map;

  const [fromSnap, toSnap] = await Promise.all([
    getDocs(query(collection(db, REQUESTS), where("fromId", "==", selfId))),
    getDocs(query(collection(db, REQUESTS), where("toId", "==", selfId))),
  ]);

  const relevant = [...fromSnap.docs, ...toSnap.docs]
    .map((item) => mapRequest(item.id, item.data()))
    .filter((r) => otherIds.includes(r.fromId) || otherIds.includes(r.toId))
    .sort((a, b) => b.createdAt - a.createdAt);

  for (const request of relevant) {
    const otherId = request.fromId === selfId ? request.toId : request.fromId;
    if (!map.has(otherId) || map.get(otherId) !== "none") continue;
    if (
      request.status === "declined" &&
      request.fromId === selfId &&
      !canResendAfterDecline(request)
    ) {
      map.set(otherId, "pending");
      continue;
    }
    map.set(otherId, request.status);
  }

  return map;
}
