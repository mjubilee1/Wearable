import type { BillingInterval, CheckoutPlan } from "@nearby/shared";
import { checkoutPlanFromInterval } from "@nearby/shared";
import { auth } from "@/lib/firebase";
import { trackFunnel } from "@/lib/funnel";
import { readPromo } from "@/lib/promo";
import { readReferral } from "@/lib/referral";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function authHeaders(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to manage billing.");
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function postBilling(path: string, body?: unknown): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: await authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
    };
    if (!res.ok || !data.url) {
      throw new Error(
        data.error ??
          `Could not start billing (${res.status}). Is the API up at ${API_URL}?`,
      );
    }
    return data.url;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `Billing timed out talking to ${API_URL}. Check the API is running and Stripe env vars are set.`,
      );
    }
    if (err instanceof TypeError) {
      throw new Error(
        `Could not reach API at ${API_URL}. Start it with pnpm dev:api.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function billingJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(await authHeaders()),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error ?? `Billing request failed (${res.status})`,
    );
  }
  return data;
}

const CHECKOUT_ERROR = "Couldn't start checkout, try again.";

export async function startCheckout(
  plan: CheckoutPlan,
  opts?: { promo?: string | null },
): Promise<string> {
  trackFunnel("checkout_started", { plan });
  const promo = opts?.promo ?? readPromo();
  const referredBy = readReferral();
  try {
    return await postBilling("/v1/billing/checkout", {
      plan,
      ...(promo ? { promoCode: promo } : {}),
      ...(referredBy ? { referredBy } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/no such customer|resource_missing|\bstripe\b/i.test(message)) {
      throw new Error(CHECKOUT_ERROR);
    }
    throw err;
  }
}

export async function startProCheckout(
  interval: BillingInterval = "month",
): Promise<string> {
  return startCheckout(checkoutPlanFromInterval(interval));
}

export async function startNearbyPlusCheckout(): Promise<string> {
  return startCheckout("pro_monthly");
}

export async function openBillingPortal(): Promise<string> {
  return postBilling("/v1/billing/portal");
}

export async function fetchTeamState(): Promise<{
  seats: number;
  memberEmails: string[];
  remaining: number;
}> {
  return billingJson("/v1/billing/team");
}

export async function inviteTeamEmail(email: string): Promise<{
  memberEmails: string[];
}> {
  return billingJson("/v1/billing/team/invite", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function removeTeamEmail(email: string): Promise<{
  memberEmails: string[];
}> {
  return billingJson("/v1/billing/team/remove", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function fetchReferralInfo(): Promise<{
  code: string | null;
  count: number;
  url: string | null;
}> {
  return billingJson("/v1/billing/referral");
}

export async function syncTeamMembership(): Promise<void> {
  try {
    await billingJson("/v1/billing/team/sync", { method: "POST" });
  } catch {
    // Optional — agent/checkout also sync.
  }
}
