"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PRO_MONTHLY_USD, PRO_TRIAL_DAYS, PRO_YEARLY_USD, hasProAccess } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { startProCheckout } from "@/lib/billing";
import { trackFunnel } from "@/lib/funnel";
import type { BillingInterval } from "@nearby/shared";
import { hasFoundingOffer } from "@/lib/offers";

const FREE = [
  "20 requests a day",
  "3 reschedules a day",
  "3 email drafts a day",
  "Calendar, tasks, mail, and notes",
];

const PRO = [
  "Unlimited requests",
  "Unlimited reschedules and drafts",
  "Voice memo recaps that turn into follow-ups.",
  "7-day free trial, card required",
  "Cancel anytime",
];

export function PricingSection({
  showHeading = true,
}: {
  showHeading?: boolean;
}) {
  const { user, profile } = useAuth();
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
        <>
          <p className="text-sm font-semibold text-teal">Pricing</p>
          <h2 className="mt-3 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
            Free to start. Pro when you want unlimited.
          </h2>
        </>
      ) : null}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-[28px] bg-white p-6 ring-1 ring-black/5">
          <p className="text-sm font-bold text-ink">Free</p>
          <p className="mt-1 text-3xl font-bold tracking-tight">$0</p>
          <ul className="mt-4 space-y-2 text-sm text-muted">
            {FREE.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <Link
            href="/signup"
            className="mt-6 inline-flex w-full items-center justify-center rounded-2xl border border-black/10 px-4 py-3 text-sm font-semibold text-ink"
          >
            Start free
          </Link>
        </div>
        <div className="rounded-[28px] bg-teal-soft/70 p-6 ring-1 ring-teal/30">
          <p className="text-sm font-bold text-ink">Pro</p>
          <p className="mt-1 text-3xl font-bold tracking-tight">
            ${foundingOffer ? 19 : PRO_MONTHLY_USD}
            <span className="text-base font-semibold text-muted">/mo</span>
          </p>
          <p className="mt-1 text-sm text-muted">
            or ${PRO_YEARLY_USD}/year · save ~28% · {PRO_TRIAL_DAYS} days free
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
                className="w-full rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy === "month"
                  ? "Opening checkout…"
                  : `Monthly · $${foundingOffer ? 19 : PRO_MONTHLY_USD}`}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void onTrial("year")}
                className="w-full rounded-2xl border border-teal/40 bg-white px-4 py-3 text-sm font-semibold text-ink disabled:opacity-60"
              >
                {busy === "year"
                  ? "Opening checkout…"
                  : `Annual · $${PRO_YEARLY_USD} · save ~28%`}
              </button>
            </div>
          ) : (
            <Link
              href={user ? "/profile" : "/signup"}
              className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white"
            >
              {pro ? "Manage plan" : "Start free"}
            </Link>
          )}
        </div>
      </div>
      {error ? <p className="mt-3 text-sm text-coral">{error}</p> : null}
    </div>
  );
}
