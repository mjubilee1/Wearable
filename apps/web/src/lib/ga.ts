type GaValue = string | number | boolean | null | undefined;

function payloadOf(params: Record<string, GaValue>): Record<string, string | number | boolean> {
  const payload: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    payload[key] = value;
  }
  return payload;
}

/** Queue a GA4 event until gtag has run its config, then send it. */
export function trackGaEvent(name: string, params: Record<string, GaValue> = {}) {
  if (typeof window === "undefined") return;
  const payload = payloadOf(params);

  const send = () => {
    if (typeof window.gtag !== "function") return false;
    window.gtag("event", name, payload);
    return true;
  };

  if (send()) return;

  const started = Date.now();
  const timer = window.setInterval(() => {
    if (send() || Date.now() - started > 15_000) window.clearInterval(timer);
  }, 250);
}
