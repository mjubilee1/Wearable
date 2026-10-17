import { createHash, randomUUID } from "node:crypto";
import {
  MESSAGE_MAX_LENGTH,
  SEED_PROFILES,
  pairIdFor,
  toPublicPreview,
  type Conversation,
  type ConversationSummary,
  type Message,
  type UserProfile,
} from "@nearby/shared";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

const MESSAGE_LIMIT_PER_MINUTE = 30;
const mockConversations = new Map<string, Conversation>();
const mockMessages = new Map<string, Message[]>();
const mockBlocks = new Set<string>();
const mockRates = new Map<string, { bucket: number; count: number }>();

export class MessagingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "messaging_error",
  ) {
    super(message);
  }
}

function profileFromSeed(uid: string): UserProfile | null {
  const seed = SEED_PROFILES.find((item) => item.id === uid);
  if (!seed) return null;
  return { ...seed, createdAt: Date.now(), updatedAt: Date.now() };
}

async function loadProfile(uid: string): Promise<UserProfile | null> {
  if (!isFirebaseConfigured()) return profileFromSeed(uid);
  const snap = await getFirebaseAdmin().firestore().collection("users").doc(uid).get();
  return snap.exists
    ? ({ id: snap.id, ...(snap.data() ?? {}) } as UserProfile)
    : null;
}

async function isBlocked(a: string, b: string): Promise<boolean> {
  if (!isFirebaseConfigured()) {
    return mockBlocks.has(`${a}_${b}`) || mockBlocks.has(`${b}_${a}`);
  }
  const db = getFirebaseAdmin().firestore();
  const [left, right] = await Promise.all([
    db.collection("blocks").doc(`${a}_${b}`).get(),
    db.collection("blocks").doc(`${b}_${a}`).get(),
  ]);
  return left.exists || right.exists;
}

async function assertConnected(a: string, b: string): Promise<void> {
  if (!isFirebaseConfigured()) {
    if (mockConversations.has(pairIdFor(a, b))) return;
    if (profileFromSeed(b)) return;
    throw new MessagingError("You can only message a connection", 403, "not_connected");
  }
  const connection = await getFirebaseAdmin()
    .firestore()
    .collection("connections")
    .doc(pairIdFor(a, b))
    .get();
  const ids = connection.data()?.userIds;
  if (!connection.exists || !Array.isArray(ids) || !ids.includes(a) || !ids.includes(b)) {
    throw new MessagingError("You can only message a connection", 403, "not_connected");
  }
}

async function assertCanMessage(a: string, b: string): Promise<void> {
  if (a === b) throw new MessagingError("You can’t message yourself");
  await assertConnected(a, b);
  if (await isBlocked(a, b)) {
    throw new MessagingError("Messaging is unavailable for this connection", 403, "blocked");
  }
}

async function consumeMessageRate(uid: string): Promise<void> {
  const bucket = Math.floor(Date.now() / 60_000);
  if (!isFirebaseConfigured()) {
    const current = mockRates.get(uid);
    const count = current?.bucket === bucket ? current.count : 0;
    if (count >= MESSAGE_LIMIT_PER_MINUTE) {
      throw new MessagingError("You’re sending too quickly. Try again shortly.", 429, "rate_limited");
    }
    mockRates.set(uid, { bucket, count: count + 1 });
    return;
  }
  const db = getFirebaseAdmin().firestore();
  const id = createHash("sha256").update(`${uid}:messages:${bucket}`).digest("hex");
  const ref = db.collection("rateLimits").doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = Number(snap.data()?.count ?? 0);
    if (count >= MESSAGE_LIMIT_PER_MINUTE) {
      throw new MessagingError("You’re sending too quickly. Try again shortly.", 429, "rate_limited");
    }
    tx.set(ref, {
      uid,
      action: "message-send",
      count: count + 1,
      expiresAt: (bucket + 1) * 60_000,
    });
  });
}

async function requireConversation(uid: string, id: string): Promise<Conversation> {
  if (!isFirebaseConfigured()) {
    const row = mockConversations.get(id);
    if (!row || !row.participants.includes(uid)) {
      throw new MessagingError("Conversation not found", 404, "not_found");
    }
    return row;
  }
  const snap = await getFirebaseAdmin().firestore().collection("conversations").doc(id).get();
  const data = snap.data() ?? {};
  const participants = Array.isArray(data.participants) ? data.participants.map(String) : [];
  if (!snap.exists || !participants.includes(uid) || participants.length !== 2) {
    throw new MessagingError("Conversation not found", 404, "not_found");
  }
  return {
    id: snap.id,
    participants: participants as [string, string],
    createdAt: Number(data.createdAt),
    updatedAt: Number(data.updatedAt),
  };
}

export async function startConversation(
  uid: string,
  recipientId: string,
): Promise<Conversation> {
  const other = recipientId.trim();
  await assertCanMessage(uid, other);
  const id = pairIdFor(uid, other);
  if (!isFirebaseConfigured()) {
    const existing = mockConversations.get(id);
    if (existing) return existing;
    const now = Date.now();
    const row: Conversation = {
      id,
      participants: [uid, other].sort() as [string, string],
      createdAt: now,
      updatedAt: now,
    };
    mockConversations.set(id, row);
    return row;
  }
  const db = getFirebaseAdmin().firestore();
  const ref = db.collection("conversations").doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const now = Date.now();
      tx.set(ref, {
        participants: [uid, other].sort(),
        createdAt: now,
        updatedAt: now,
        lastMessage: null,
      });
    }
  });
  return requireConversation(uid, id);
}

export async function listConversations(uid: string): Promise<ConversationSummary[]> {
  const conversations: Array<Conversation & { lastMessage?: ConversationSummary["lastMessage"] }> =
    [];
  if (!isFirebaseConfigured()) {
    for (const row of mockConversations.values()) {
      if (!row.participants.includes(uid)) continue;
      const messages = mockMessages.get(row.id) ?? [];
      const last = messages.at(-1);
      conversations.push({
        ...row,
        lastMessage: last
          ? { content: last.content, senderId: last.senderId, createdAt: last.createdAt }
          : null,
      });
    }
  } else {
    const snap = await getFirebaseAdmin()
      .firestore()
      .collection("conversations")
      .where("participants", "array-contains", uid)
      .orderBy("updatedAt", "desc")
      .get();
    for (const doc of snap.docs) {
      const data = doc.data() ?? {};
      conversations.push({
        id: doc.id,
        participants: data.participants as [string, string],
        createdAt: Number(data.createdAt),
        updatedAt: Number(data.updatedAt),
        lastMessage: (data.lastMessage ?? null) as ConversationSummary["lastMessage"],
      });
    }
  }

  const result: ConversationSummary[] = [];
  for (const row of conversations.sort((a, b) => b.updatedAt - a.updatedAt)) {
    const otherId = row.participants.find((id) => id !== uid);
    if (!otherId || (await isBlocked(uid, otherId))) continue;
    const profile = await loadProfile(otherId);
    if (!profile) continue;
    result.push({ ...row, other: toPublicPreview(profile), lastMessage: row.lastMessage ?? null });
  }
  return result;
}

export async function listMessages(uid: string, conversationId: string): Promise<Message[]> {
  const conversation = await requireConversation(uid, conversationId);
  const other = conversation.participants.find((id) => id !== uid)!;
  if (await isBlocked(uid, other)) {
    throw new MessagingError("Messaging is unavailable for this connection", 403, "blocked");
  }
  if (!isFirebaseConfigured()) return [...(mockMessages.get(conversationId) ?? [])];
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("messages")
    .where("conversationId", "==", conversationId)
    .orderBy("createdAt", "asc")
    .limit(200)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }) as Message);
}

export async function sendMessage(
  uid: string,
  conversationId: string,
  rawContent: string,
): Promise<Message> {
  const content = rawContent.trim();
  if (!content) throw new MessagingError("Write a message first");
  if (content.length > MESSAGE_MAX_LENGTH) {
    throw new MessagingError(`Keep messages under ${MESSAGE_MAX_LENGTH} characters`);
  }
  const conversation = await requireConversation(uid, conversationId);
  const recipientId = conversation.participants.find((id) => id !== uid)!;
  await assertCanMessage(uid, recipientId);
  await consumeMessageRate(uid);
  const now = Date.now();
  const message: Message = {
    id: randomUUID(),
    conversationId,
    senderId: uid,
    recipientId,
    content,
    messageType: "TEXT",
    deliveryStatus: "SENT",
    createdAt: now,
  };
  if (!isFirebaseConfigured()) {
    mockMessages.set(conversationId, [...(mockMessages.get(conversationId) ?? []), message]);
    mockConversations.set(conversationId, { ...conversation, updatedAt: now });
    return message;
  }
  const db = getFirebaseAdmin().firestore();
  const messageRef = db.collection("messages").doc(message.id);
  const conversationRef = db.collection("conversations").doc(conversationId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(conversationRef);
    const participants = snap.data()?.participants;
    if (!snap.exists || !Array.isArray(participants) || !participants.includes(uid)) {
      throw new MessagingError("Conversation not found", 404, "not_found");
    }
    tx.set(messageRef, message);
    tx.update(conversationRef, {
      updatedAt: now,
      lastMessage: { content, senderId: uid, createdAt: now },
    });
  });
  return message;
}

export async function blockConversationUser(uid: string, conversationId: string) {
  const conversation = await requireConversation(uid, conversationId);
  const blockedId = conversation.participants.find((id) => id !== uid)!;
  const id = `${uid}_${blockedId}`;
  if (!isFirebaseConfigured()) {
    mockBlocks.add(id);
    return { ok: true };
  }
  await getFirebaseAdmin().firestore().collection("blocks").doc(id).set({
    id,
    blockerId: uid,
    blockedId,
    createdAt: Date.now(),
  });
  return { ok: true };
}

export async function reportConversationUser(
  uid: string,
  conversationId: string,
  reason: string,
) {
  const conversation = await requireConversation(uid, conversationId);
  const reportedId = conversation.participants.find((id) => id !== uid)!;
  const cleanReason = reason.trim().slice(0, 500);
  if (!cleanReason) throw new MessagingError("Choose or enter a report reason");
  if (!isFirebaseConfigured()) return { ok: true };
  await getFirebaseAdmin().firestore().collection("userReports").doc(randomUUID()).set({
    reporterId: uid,
    reportedId,
    conversationId,
    reason: cleanReason,
    createdAt: Date.now(),
    status: "OPEN",
  });
  return { ok: true };
}

export function resetMessagingMocksForTest() {
  mockConversations.clear();
  mockMessages.clear();
  mockBlocks.clear();
  mockRates.clear();
}
