export const INVITE_STORAGE_KEY = "nearby_invite";

export function isInviteCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{8,32}$/.test(code);
}

export function inviteCodeFromPath(path: string): string | null {
  const match = path.match(/^\/invite\/([A-Za-z0-9_-]{8,32})\/?$/);
  return match?.[1] ?? null;
}

/** The only text that leaves Nearby. The conversation itself stays in the app. */
export function inviteJoinMessage(link: string): string {
  return `Join me on Nearby: ${link}`;
}
