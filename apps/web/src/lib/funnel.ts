import { track } from "@vercel/analytics";
import { readFirstTouch } from "@/lib/attribution";

export type FunnelEvent =
  | "landing_view"
  | "signup_start"
  | "signup_complete"
  | "google_connected"
  | "first_task_done"
  | "limit_reached"
  | "upgrade_click"
  | "checkout_started"
  | "trial_started"
  | "subscription_active"
  | "subscription_cancelled";

type FunnelProps = Record<string, string | number | boolean | null>;

/** Fire a Vercel custom event once for this step. Pass a key to dedupe. */
export function trackFunnel(
  event: FunnelEvent,
  props?: FunnelProps,
  dedupe?: { scope: "session" | "local"; key: string },
) {
  if (typeof window === "undefined") return;
  if (dedupe) {
    try {
      const store = dedupe.scope === "local" ? localStorage : sessionStorage;
      const storageKey = `nearby_funnel:${dedupe.key}`;
      if (store.getItem(storageKey)) return;
      store.setItem(storageKey, "1");
    } catch {
      // If storage is blocked, still emit the event.
    }
  }
  const touch = readFirstTouch();
  const data: FunnelProps = {
    plan: props?.plan ?? "free",
    ...props,
  };
  if (touch.utm_source) data.utm_source = touch.utm_source;
  track(event, data);
}
