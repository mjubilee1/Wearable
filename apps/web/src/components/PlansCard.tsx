"use client";

// PARITY: mobile — Pro plan card, checkout, and portal are web-only for this phase.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  PRO_ANNUAL_SAVE_PERCENT,
  PRO_MONTHLY_USD,
  PRO_YEARLY_USD,
  TEAM_MONTHLY_USD,
  TEAM_SEATS,
  hasProAccess,
  normalizePlan,
  type CheckoutPlan,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { openBillingPortal, startCheckout, syncTeamMembership } from "@/lib/billing";
import { trackFunnel } from "@/lib/funnel";
import { capturePromo } from "@/lib/promo";

function statusLine(profile: NonNullable<ReturnType<typeof useAuth>["profile"]>): string {
  if (profile.subscriptionStatus === "past_due" || profile.paymentFailedAt) {
    return hasProAccess(profile) ? "Pro · payment failed" : "Free · payment failed";
  }
  if (!hasProAccess(profile)) {
    if (profile.subscriptionStatus === "canceled") return "Free · canceled";
    return "Free";
  }
  const plan = normalizePlan(profile.plan);
  if (plan === "team") return "Team";
  if (plan === "team_member") return "Pro · team seat";
  if (profile.subscriptionStatus === "trialing") {
    if (plan === "pro_annual") return "Pro annual · trial";
    return "Pro · trial";
  }
  if (profile.cancelAtPeriodEnd && profile.currentPeriodEnd) {
    const when = new Date(profile.currentPeriodEnd).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return `Pro · cancels ${when}`;
  }
  if (plan === "pro_annual" || profile.billingInterval === "year") {
    return "Pro · annual";
  }
  return "Pro · monthly";
}

export function PlansCard() {
  const { profile, refreshProfile } = useAuth();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState<CheckoutPlan | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const billing = searchParams.get("billing");

  useEffect(() => {
    capturePromo();
    void syncTeamMembership().then(() => refreshProfile());
  }, [refreshProfile]);

  if (!profile) return null;
  const pro = hasProAccess(profile);
  const isTeamMember = normalizePlan(profile.plan) === "team_member";

  async function onUpgrade(plan: CheckoutPlan) {
    setError(null);
    setBusy(plan);
    trackFunnel("upgrade_click", { plan });
    try {
      window.location.href = await startCheckout(plan);
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
          ? isTeamMember
            ? "Unlimited through your team."
            : "Unlimited requests, reschedules, and email drafts."
          : `Free includes 20 requests, 3 reschedules, and 3 email drafts a day. Pro is $${PRO_MONTHLY_USD}/mo or $${PRO_YEARLY_USD}/yr. Team is $${TEAM_MONTHLY_USD}/mo for ${TEAM_SEATS} seats.`}
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

      {(profile.subscriptionStatus === "active" ||
        profile.subscriptionStatus === "trialing") &&
      !isTeamMember ? (
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
            onClick={() => void onUpgrade("pro_monthly")}
            className="w-full rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy === "pro_monthly"
              ? "Opening checkout…"
              : `Monthly · $${PRO_MONTHLY_USD}`}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onUpgrade("pro_annual")}
            className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm font-semibold text-ink disabled:opacity-60"
          >
            {busy === "pro_annual"
              ? "Opening checkout…"
              : `Annual · $${PRO_YEARLY_USD} · save ~${PRO_ANNUAL_SAVE_PERCENT}%`}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onUpgrade("team")}
            className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm font-semibold text-ink disabled:opacity-60"
          >
            {busy === "team"
              ? "Opening checkout…"
              : `Team · $${TEAM_MONTHLY_USD}/mo · ${TEAM_SEATS} seats`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
