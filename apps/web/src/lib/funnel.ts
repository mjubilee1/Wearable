import { track } from "@vercel/analytics";
import { captureAttribution } from "@/lib/attribution";
import { trackGaEvent } from "@/lib/ga";

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
  const touch = captureAttribution();
  const data: FunnelProps = {
    ...(touch.utm_source ? { utm_source: touch.utm_source } : {}),
    ...(touch.utm_medium ? { utm_medium: touch.utm_medium } : {}),
    ...(touch.utm_campaign ? { utm_campaign: touch.utm_campaign } : {}),
    plan: props?.plan ?? "free",
    ...props,
  };
  track(event, data);
  if (event === "signup_start" || event === "signup_complete") {
    trackGaEvent(event, {
      method: "email",
      campaign_source: touch.utm_source,
      campaign_name: touch.utm_campaign,
      ...data,
    });
  }
}
