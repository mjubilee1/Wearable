const SESSION_KEY = "nearby_utm_source";
const TOUCH_KEY = "nearby_attribution_v1";

export type FirstTouch = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
};

/** Channel slug from a utm param, or null when missing or invalid. */
export function sanitizeUtmSource(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) return null;
  return value;
}

function emptyTouch(): FirstTouch {
  return { utm_source: null, utm_medium: null, utm_campaign: null };
}

export function readFirstTouch(): FirstTouch {
  if (typeof window === "undefined") return emptyTouch();
  try {
    const raw = localStorage.getItem(TOUCH_KEY);
    if (!raw) return emptyTouch();
    const parsed = JSON.parse(raw) as Partial<FirstTouch>;
    return {
      utm_source: sanitizeUtmSource(parsed.utm_source),
      utm_medium: sanitizeUtmSource(parsed.utm_medium),
      utm_campaign: sanitizeUtmSource(parsed.utm_campaign),
    };
  } catch {
    return emptyTouch();
  }
}

function writeTouch(touch: FirstTouch) {
  try {
    localStorage.setItem(TOUCH_KEY, JSON.stringify(touch));
  } catch {
    // Private mode can block storage. The URL value still counts for this call.
  }
}

/**
 * Keep the first utm_source, utm_medium, and utm_campaign seen in this browser.
 * Later visits do not overwrite them.
 */
export function captureAttribution(search?: string): FirstTouch {
  if (typeof window === "undefined") return emptyTouch();

  const params = new URLSearchParams(search ?? window.location.search);
  const fromUrl: FirstTouch = {
    utm_source: sanitizeUtmSource(params.get("utm_source")),
    utm_medium: sanitizeUtmSource(params.get("utm_medium")),
    utm_campaign: sanitizeUtmSource(params.get("utm_campaign")),
  };
  const stored = readFirstTouch();
  const storedAny = stored.utm_source || stored.utm_medium || stored.utm_campaign;
  if (storedAny) {
    if (stored.utm_source) {
      try {
        sessionStorage.setItem(SESSION_KEY, stored.utm_source);
      } catch {
        // Ignore storage failures.
      }
    }
    return stored;
  }

  const urlAny = fromUrl.utm_source || fromUrl.utm_medium || fromUrl.utm_campaign;
  if (urlAny) {
    writeTouch(fromUrl);
    if (fromUrl.utm_source) {
      try {
        sessionStorage.setItem(SESSION_KEY, fromUrl.utm_source);
      } catch {
        // Ignore storage failures.
      }
    }
    return fromUrl;
  }

  return emptyTouch();
}

/**
 * Prefer the first-touch source, then the current URL, then this tab.
 * Falls back to "marketing" when no channel was posted.
 */
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

/** Signup URL that keeps the campaign params from this request. */
export function signupHref(params: { get(name: string): string | null }): string {
  const next = new URLSearchParams();
  for (const key of UTM_KEYS) {
    const value = sanitizeUtmSource(params.get(key));
    if (value) next.set(key, value);
  }
  const query = next.toString();
  return query ? `/signup?${query}` : "/signup";
}

export function captureUtmSource(search?: string): string {
  const touch = captureAttribution(search);
  if (touch.utm_source) return touch.utm_source;
  if (typeof window === "undefined") return "marketing";
  try {
    return sanitizeUtmSource(sessionStorage.getItem(SESSION_KEY)) ?? "marketing";
  } catch {
    return "marketing";
  }
}
