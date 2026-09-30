"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isNearbyPlus } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { openBillingPortal, startNearbyPlusCheckout } from "@/lib/billing";

export function NearbyPlusBillingCard() {
  const { profile, refreshProfile } = useAuth();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const plus = profile ? isNearbyPlus(profile) : false;

  useEffect(() => {
    const billing = searchParams.get("billing");
    if (billing === "success") {
      setFlash("Nearby+ is activating — this usually takes a few seconds.");
      void refreshProfile();
      const t = setTimeout(() => void refreshProfile(), 2500);
      return () => clearTimeout(t);
    }
    if (billing === "canceled") {
      setFlash("Checkout canceled. You can upgrade anytime.");
    }
  }, [searchParams, refreshProfile]);

  async function onUpgrade() {
    setError(null);
    setBusy(true);
    try {
      const url = await startNearbyPlusCheckout();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setBusy(false);
    }
  }

  async function onManage() {
    setError(null);
    setBusy(true);
    try {
      const url = await openBillingPortal();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open portal");
      setBusy(false);
    }
  }

  if (!profile) return null;

  return (
    <section className="mb-8 rounded-3xl border border-black/5 bg-gradient-to-br from-teal-soft/80 to-card p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
        Nearby+
      </p>
      <h2 className="mt-1 text-lg font-bold tracking-tight text-ink">
        {plus ? "You're on Nearby+" : "Stay in the loop"}
      </h2>
      <p className="mt-2 text-sm text-muted">
        {plus
          ? "Unlimited facilitate, walk-by memory, and priority matching as those ship."
          : "Upgrade for better hellos, walk-by history, and profile insights — the wearable gets you in; Nearby+ keeps you coming back."}
      </p>

      {flash && (
        <p className="mt-3 rounded-2xl bg-card/80 px-3 py-2 text-sm text-teal">
          {flash}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-2xl bg-coral-soft px-3 py-2 text-sm text-coral">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={plus ? onManage : onUpgrade}
        className="mt-4 w-full rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
      >
        {busy
          ? "Redirecting…"
          : plus
            ? "Manage subscription"
            : "Upgrade to Nearby+"}
      </button>

      {!plus && (
        <p className="mt-2 text-center text-[11px] text-muted">
          Cancel anytime in the Stripe customer portal.
        </p>
      )}
    </section>
  );
}
