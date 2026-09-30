import { auth } from "@/lib/firebase";

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

async function postBilling(path: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: await authHeaders(),
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

export async function startNearbyPlusCheckout(): Promise<string> {
  return postBilling("/v1/billing/checkout");
}

export async function openBillingPortal(): Promise<string> {
  return postBilling("/v1/billing/portal");
}
