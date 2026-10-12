const STORAGE_KEY = "nearby_utm_source";

/** Channel slug from ?utm_source=, or null when missing or invalid. */
export function sanitizeUtmSource(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) return null;
  return value;
}

/**
 * Prefer the current URL, then the value saved for this tab.
 * Falls back to "marketing" when no channel was posted.
 */
export function captureUtmSource(search?: string): string {
  if (typeof window === "undefined") return "marketing";

  const params = new URLSearchParams(
    search ?? window.location.search,
  );
  const fromUrl = sanitizeUtmSource(params.get("utm_source"));
  if (fromUrl) {
    try {
      sessionStorage.setItem(STORAGE_KEY, fromUrl);
    } catch {
      // Private mode can block storage; the URL value still counts.
    }
    return fromUrl;
  }

  try {
    return sanitizeUtmSource(sessionStorage.getItem(STORAGE_KEY)) ?? "marketing";
  } catch {
    return "marketing";
  }
}
