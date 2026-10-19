"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FREE_DAILY_REQUESTS,
  PRO_MONTHLY_USD,
  PRO_TRIAL_DAYS,
  PRO_YEARLY_USD,
  hasProAccess,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { startProCheckout } from "@/lib/billing";
import { trackFunnel } from "@/lib/funnel";
import type { BillingInterval } from "@nearby/shared";
import { hasFoundingOffer } from "@/lib/offers";
import { useSignupHref } from "@/lib/use-signup-href";

const FREE = [
  `${FREE_DAILY_REQUESTS} requests a day`,
  "Reschedules and drafts count as requests",
  "Messages with your connections",
  "Calendar, tasks, mail, and notes",
];

const PRO = [
  "Unlimited requests when your day is stacked with calls",
  "Voice memo recaps that turn a long call into follow-ups",
  "7-day free trial, card required",
  "Cancel anytime",
];

export function PricingSection({
  showHeading = true,
  proTrialCta = false,
}: {
  showHeading?: boolean;
  /** Pricing page Pro button. Homepage keeps "Start free". */
  proTrialCta?: boolean;
}) {
  const { user, profile } = useAuth();
  const accountHref = useSignupHref();
  const pro = profile ? hasProAccess(profile) : false;
  const [busy, setBusy] = useState<BillingInterval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [foundingOffer, setFoundingOffer] = useState(false);

  useEffect(() => {
    setFoundingOffer(
      hasFoundingOffer(new URLSearchParams(window.location.search)),
    );
  }, []);

  async function onTrial(interval: BillingInterval) {
    if (!user) return;
    setError(null);
    setBusy(interval);
    const plan = interval === "year" ? "pro_yearly" : "pro_monthly";
    trackFunnel("upgrade_click", { plan });
    try {
      window.location.href = await startProCheckout(interval);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setBusy(null);
    }
  }

  return (
    <div>
      {showHeading ? (
        <h2 className="font-display text-4xl font-medium leading-none sm:text-5xl">
          Free to start. Pro when you want unlimited.
        </h2>
      ) : null}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="border border-ink/20 bg-white p-6">
          <p className="text-sm text-muted">Free</p>
          <p className="font-display mt-2 text-5xl font-medium leading-none">$0</p>
          <ul className="mt-4 space-y-2 text-sm text-muted">
            {FREE.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <Link
            href={accountHref}
            className="mt-6 inline-flex w-full items-center justify-center border border-ink/20 px-4 py-3 text-sm font-semibold text-ink"
          >
            Start free
          </Link>
        </div>
        <div className="border border-ink bg-white p-6">
          <p className="text-sm text-teal">Pro</p>
          <p className="font-display mt-2 text-5xl font-medium leading-none">
            ${foundingOffer ? 19 : PRO_MONTHLY_USD}
            <span className="font-sans text-base font-medium text-muted">/mo</span>
          </p>
          <p className="mt-1 text-sm text-muted">
            or ${PRO_YEARLY_USD}/year · save ~28% · {PRO_TRIAL_DAYS} days free
          </p>
          <p className="mt-3 border border-teal/30 bg-teal-soft px-3 py-2 text-sm text-teal">
            {foundingOffer
              ? "FOUNDING19 applied: $19/month for life."
              : "Founding offer: use FOUNDING19 for $19/month for life."}
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted">
            {PRO.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {user && !pro ? (
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onTrial("month")}
                className="w-full bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy === "month"
                  ? "Opening checkout…"
                  : `Monthly · $${foundingOffer ? 19 : PRO_MONTHLY_USD}`}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onTrial("year")}
                className="w-full border border-ink/20 bg-white px-4 py-3 text-sm font-semibold text-ink disabled:opacity-60"
              >
                {busy === "year"
                  ? "Opening checkout…"
                  : `Annual · $${PRO_YEARLY_USD} · save ~28%`}
              </button>
            </div>
          ) : (
            <div className="mt-6">
              <Link
                href={user ? "/profile" : accountHref}
                className="inline-flex w-full items-center justify-center bg-ink px-4 py-3 text-center text-sm font-semibold text-white"
              >
                {pro
                  ? "Manage plan"
                  : proTrialCta
                    ? "Start 7-day free trial, card required"
                    : "Start free"}
              </Link>
            </div>
          )}
        </div>
      </div>
      {error ? <p className="mt-3 text-sm text-coral">{error}</p> : null}
      {/* TODO(Montrell): Add the first-month money-back sentence only after confirming it is current product policy. */}
    </div>
  );
}
