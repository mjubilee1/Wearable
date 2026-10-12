"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";
import { hasProAccess } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { trackFunnel } from "@/lib/funnel";

function chargeDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });
}

function daysLeft(trialEndsAt: number): number {
  const ms = trialEndsAt - Date.now();
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

export function TrialBanner() {
  const { user, profile, refreshProfile } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (searchParams.get("billing") !== "success") return;
    void refreshProfile();
    const timers = [1500, 4000].map((delay) =>
      setTimeout(() => {
        void refreshProfile();
        void queryClient.invalidateQueries({ queryKey: ["agent-history"] });
      }, delay),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [queryClient, refreshProfile, searchParams]);

  useEffect(() => {
    if (!user || !profile) return;
    const plan = hasProAccess(profile) ? "pro" : "free";
    if (profile.subscriptionStatus === "trialing" && profile.trialEndsAt) {
      trackFunnel("trial_started", { plan: "pro" }, {
        scope: "local",
        key: `trial_started:${user.uid}:${profile.trialEndsAt}`,
      });
    }
    if (
      profile.subscriptionStatus === "active" &&
      profile.stripeSubscriptionId
    ) {
      trackFunnel("subscription_active", { plan: "pro" }, {
        scope: "local",
        key: `subscription_active:${user.uid}:${profile.stripeSubscriptionId}`,
      });
    }
    if (
      profile.cancelAtPeriodEnd ||
      (profile.subscriptionStatus === "canceled" && profile.stripeCustomerId)
    ) {
      trackFunnel("subscription_cancelled", { plan }, {
        scope: "local",
        key: `subscription_cancelled:${user.uid}:${profile.currentPeriodEnd ?? "end"}`,
      });
    }
  }, [profile, user]);

  if (!profile || profile.subscriptionStatus !== "trialing" || !profile.trialEndsAt) {
    return null;
  }
  if (pathname === "/" || pathname === "/pricing") return null;

  const left = daysLeft(profile.trialEndsAt);
  const when = chargeDate(profile.trialEndsAt);

  return (
    <div className="border-b border-teal/20 bg-teal-soft px-4 py-3 text-sm text-ink">
      <p className="mx-auto max-w-5xl">
        {left <= 1
          ? "Your Pro trial ends today."
          : `Pro trial: ${left} days left.`}{" "}
        Your card will be charged on {when}.
      </p>
    </div>
  );
}
