const REF_KEY = "nearby_referral_code";

/** Remember /r/<code> for signup → checkout. */
export function captureReferral(code: string): string | null {
  const normalized = code.trim().toLowerCase();
  if (!/^[a-z0-9]{4,32}$/.test(normalized)) return null;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(REF_KEY, normalized);
      localStorage.setItem(REF_KEY, normalized);
    } catch {
      // Ignore storage failures.
    }
  }
  return normalized;
}

export function readReferral(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const session = sessionStorage.getItem(REF_KEY)?.trim().toLowerCase();
    if (session && /^[a-z0-9]{4,32}$/.test(session)) return session;
    const local = localStorage.getItem(REF_KEY)?.trim().toLowerCase();
    if (local && /^[a-z0-9]{4,32}$/.test(local)) return local;
  } catch {
    // Ignore.
  }
  return null;
}
