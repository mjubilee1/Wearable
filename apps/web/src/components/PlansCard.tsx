"use client";

// PARITY: mobile — Pro plan card, checkout, and portal are web-only for this phase.

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  PRO_MONTHLY_USD,
  PRO_YEARLY_USD,
  hasProAccess,
  type BillingInterval,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { openBillingPortal, startProCheckout } from "@/lib/billing";
import { trackFunnel } from "@/lib/funnel";

function statusLine(profile: NonNullable<ReturnType<typeof useAuth>["profile"]>): string {
  if (profile.subscriptionStatus === "past_due" || profile.paymentFailedAt) {
    return hasProAccess(profile) ? "Pro · payment failed" : "Free · payment failed";
  }
  if (!hasProAccess(profile)) {
    if (profile.subscriptionStatus === "canceled") return "Free · canceled";
    return "Free";
  }
  if (profile.subscriptionStatus === "trialing") return "Pro · trial";
  if (profile.cancelAtPeriodEnd && profile.currentPeriodEnd) {
    const when = new Date(profile.currentPeriodEnd).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return `Pro · cancels ${when}`;
  }
  if (profile.billingInterval === "year") return "Pro · yearly";
  return "Pro · monthly";
}

export function PlansCard() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState<"month" | "year" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const billing = searchParams.get("billing");

  if (!profile) return null;
  const pro = hasProAccess(profile);

  async function onUpgrade(interval: BillingInterval) {
    setError(null);
    setBusy(interval);
    const plan = interval === "year" ? "pro_yearly" : "pro_monthly";
    trackFunnel("upgrade_click", { plan });
    try {
      window.location.href = await startProCheckout(interval);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message || "Couldn't start checkout, try again.");
      setBusy(null);
    }
  }

  async function onManage() {
    setError(null);
    setBusy("portal");
    try {
      window.location.href = await openBillingPortal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing");
      setBusy(null);
    }
  }

  return (
    <section className="mb-6 rounded-3xl border border-black/5 bg-card px-5 py-6 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
        Plan
      </p>
      <h2 className="mt-1 text-lg font-bold tracking-tight text-ink">
        {statusLine(profile)}
      </h2>
      <p className="mt-2 text-sm text-muted">
        {pro
          ? "Unlimited requests, reschedules, and email drafts."
          : `Free includes 20 requests, 3 reschedules, and 3 email drafts a day. Pro is $${PRO_MONTHLY_USD}/mo or $${PRO_YEARLY_USD}/yr, free for 7 days.`}
      </p>

      {billing === "success" ? (
        <p className="mt-3 rounded-2xl bg-teal-soft px-3 py-2 text-sm text-teal">
          Checkout finished. Pro shows here as soon as Stripe confirms it.
        </p>
      ) : null}
      {billing === "canceled" ? (
        <p className="mt-3 rounded-2xl bg-surface px-3 py-2 text-sm text-muted">
          Checkout canceled. You can upgrade anytime.
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-2xl bg-coral-soft px-3 py-2 text-sm text-coral">
          {error}
        </p>
      ) : null}

      {profile.subscriptionStatus === "active" ||
      profile.subscriptionStatus === "trialing" ? (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onManage()}
          className="mt-4 w-full rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy === "portal" ? "Opening…" : "Manage billing"}
        </button>
      ) : null}

      {!pro ? (
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onUpgrade("month")}
            className="w-full rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy === "month"
              ? "Opening checkout…"
              : `Monthly · $${PRO_MONTHLY_USD}`}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onUpgrade("year")}
            className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm font-semibold text-ink disabled:opacity-60"
          >
            {busy === "year"
              ? "Opening checkout…"
              : `Annual · $${PRO_YEARLY_USD} · save ~28%`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
