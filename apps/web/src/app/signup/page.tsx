"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isEmailLikeName } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { captureAttribution } from "@/lib/attribution";
import { trackFunnel } from "@/lib/funnel";
import { capturePromo } from "@/lib/promo";
import { readReferral } from "@/lib/referral";

const ONBOARDING_FLAG = "nearby_onboarding";

export default function SignupPage() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    capturePromo();
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
        referredBy: readReferral(),
      });
      trackFunnel("signup_complete", { plan: "free" }, {
        scope: "session",
        key: "signup_complete",
      });
      router.replace("/onboarding");
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
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
        Nearby
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">
        Create your account
      </h1>
      <p className="mt-2 text-sm text-muted">Then you can talk.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-ink">First name</span>
          <input
            required
            autoComplete="given-name"
            placeholder="Your first name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
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
            className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
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
            className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
          />
        </label>

        {error && (
          <p className="rounded-2xl bg-coral-soft px-3 py-2 text-sm text-coral">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-teal">
          Sign in
        </Link>
      </p>
    </div>
  );
}
