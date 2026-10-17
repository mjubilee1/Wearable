import { randomBytes } from "node:crypto";
import { pairIdFor } from "@nearby/shared";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

type InviteRecord = { code: string; fromId: string; createdAt: number };

const mockInvites = new Map<string, InviteRecord>();
const mockUserCodes = new Map<string, string>();
const mockConnections = new Map<string, { userIds: string[] }>();
const mockBlocks = new Set<string>();

export class InviteError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "invite_error",
  ) {
    super(message);
  }
}

export function resetInvitesForTest() {
  mockInvites.clear();
  mockUserCodes.clear();
  mockConnections.clear();
  mockBlocks.clear();
}

export function blockPairForTest(a: string, b: string) {
  mockBlocks.add(`${a}_${b}`);
}

function newCode(): string {
  return randomBytes(9).toString("base64url");
}

async function blocked(a: string, b: string): Promise<boolean> {
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

export async function createInvite(uid: string): Promise<{ code: string }> {
  if (!isFirebaseConfigured()) {
    const existing = mockUserCodes.get(uid);
    if (existing) return { code: existing };
    const code = newCode();
    mockUserCodes.set(uid, code);
    mockInvites.set(code, { code, fromId: uid, createdAt: Date.now() });
    return { code };
  }
  const db = getFirebaseAdmin().firestore();
  const privateRef = db.collection("userPrivate").doc(uid);
  const current = await privateRef.get();
  const saved = current.data()?.inviteCode;
  if (typeof saved === "string" && saved) {
    const codeDoc = await db.collection("inviteCodes").doc(saved).get();
    if (codeDoc.exists) return { code: saved };
  }
  const code = newCode();
  const now = Date.now();
  await db.collection("inviteCodes").doc(code).set({ fromId: uid, createdAt: now });
  await privateRef.set({ inviteCode: code, updatedAt: now }, { merge: true });
  return { code };
}

export async function acceptInvite(
  uid: string,
  rawCode: string,
): Promise<{ otherId: string }> {
  const code = rawCode.trim();
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(code)) {
    throw new InviteError("That invite link is not valid", 404, "not_found");
  }
  if (!isFirebaseConfigured()) {
    const invite = mockInvites.get(code);
    if (!invite) throw new InviteError("That invite link is not valid", 404, "not_found");
    if (invite.fromId === uid) {
      throw new InviteError("That's your invite link", 400, "self");
    }
    if (await blocked(uid, invite.fromId)) {
      throw new InviteError("Messaging is unavailable for this person", 403, "blocked");
    }
    const id = pairIdFor(uid, invite.fromId);
    mockConnections.set(id, { userIds: [uid, invite.fromId].sort() });
    return { otherId: invite.fromId };
  }
  const db = getFirebaseAdmin().firestore();
  const inviteSnap = await db.collection("inviteCodes").doc(code).get();
  const fromId = String(inviteSnap.data()?.fromId ?? "");
  if (!inviteSnap.exists || !fromId) {
    throw new InviteError("That invite link is not valid", 404, "not_found");
  }
  if (fromId === uid) throw new InviteError("That's your invite link", 400, "self");
  if (await blocked(uid, fromId)) {
    throw new InviteError("Messaging is unavailable for this person", 403, "blocked");
  }
  const id = pairIdFor(uid, fromId);
  const ref = db.collection("connections").doc(id);
  const existing = await ref.get();
  if (!existing.exists) {
    const now = Date.now();
    await ref.set({
      id,
      pairId: id,
      userIds: [uid, fromId].sort(),
      requestId: `invite:${code}`,
      createdAt: now,
    });
  }
  return { otherId: fromId };
}
