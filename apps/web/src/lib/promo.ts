const PROMO_KEY = "nearby_promo_code";

/** Remember ?promo= for checkout (e.g. FOUNDING19). */
export function capturePromo(search?: string): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(search ?? window.location.search);
  const fromUrl = params.get("promo")?.trim().toUpperCase() || null;
  if (fromUrl && /^[A-Z0-9_-]{2,32}$/.test(fromUrl)) {
    try {
      sessionStorage.setItem(PROMO_KEY, fromUrl);
    } catch {
      // Ignore storage failures.
    }
    return fromUrl;
  }
  return readPromo();
}

export function readPromo(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = sessionStorage.getItem(PROMO_KEY)?.trim().toUpperCase() || null;
    if (value && /^[A-Z0-9_-]{2,32}$/.test(value)) return value;
  } catch {
    // Ignore.
  }
  return null;
}
