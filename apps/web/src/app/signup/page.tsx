"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { isEmailLikeName } from "@nearby/shared";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth-context";
import { captureAttribution } from "@/lib/attribution";
import { trackFunnel } from "@/lib/funnel";
import { hasFoundingOffer, storedReferralCode } from "@/lib/offers";

const ONBOARDING_FLAG = "nearby_onboarding";

export default function SignupPage() {
  const { signUp } = useAuth();
  const [foundingOffer, setFoundingOffer] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setFoundingOffer(hasFoundingOffer(new URLSearchParams(window.location.search)));
    trackFunnel("signup_start", { plan: "free" }, {
      scope: "session",
      key: "signup_start",
    });
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed || isEmailLikeName(trimmed, email)) {
      setError("Enter your first name, not your email.");
      return;
    }

    setSubmitting(true);
    try {
      const touch = captureAttribution();
      let timeZone: string | null = null;
      try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      } catch {
        timeZone = null;
      }
      try {
        sessionStorage.setItem(ONBOARDING_FLAG, "1");
      } catch {
        // Onboarding still runs from this page's redirect.
      }
      await signUp({
        email: email.trim(),
        password,
        name: trimmed,
        timeZone,
        utmSource: touch.utm_source,
        utmMedium: touch.utm_medium,
        utmCampaign: touch.utm_campaign,
        referredByCode: storedReferralCode(),
      });
    } catch (err) {
      try {
        sessionStorage.removeItem(ONBOARDING_FLAG);
      } catch {
        // Ignore storage failures.
      }
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <BrandMark className="font-display text-3xl italic text-ink" />
      <h1 className="font-display mt-6 text-4xl font-medium leading-none text-ink">
        Create your account
      </h1>
      <p className="mt-2 text-sm text-muted">Then you can talk.</p>
      {foundingOffer ? (
        <p className="mt-3 border border-teal/30 bg-teal-soft px-3 py-2 text-sm text-teal">
          Founding offer saved: Pro is $19/month after your 7-day trial.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-ink">First name</span>
          <input
            required
            autoComplete="given-name"
            placeholder="Your first name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-ink/20 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-ink">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-ink/20 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-ink">Password</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-ink/20 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink"
          />
        </label>

        {error && (
          <p className="border border-coral/30 bg-coral-soft px-3 py-2 text-sm text-coral">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-ink underline decoration-teal decoration-2 underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
