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

export async function startNearbyPlusCheckout(): Promise<string> {
  const res = await fetch(`${API_URL}/v1/billing/checkout`, {
    method: "POST",
    headers: await authHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!res.ok || !data.url) {
    throw new Error(data.error ?? "Could not start checkout");
  }
  return data.url;
}

export async function openBillingPortal(): Promise<string> {
  const res = await fetch(`${API_URL}/v1/billing/portal`, {
    method: "POST",
    headers: await authHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!res.ok || !data.url) {
    throw new Error(data.error ?? "Could not open billing portal");
  }
  return data.url;
}
