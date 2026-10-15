"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

const COOLDOWN_MS = 60_000;
const RESEND_KEY = "nearby_verify_resend_at";

function readCooldownUntil(): number {
  try {
    const parsed = Number(sessionStorage.getItem(RESEND_KEY) ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

export function VerifyEmailScreen() {
  const { user, resendVerificationEmail, confirmEmailVerified, signOut } = useAuth();
  const [cooldownUntil, setCooldownUntil] = useState(readCooldownUntil);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"resend" | "check" | null>(null);

  useEffect(() => {
    if (now >= cooldownUntil) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [cooldownUntil, now]);

  const remaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  async function onResend() {
    if (remaining > 0 || busy) return;
    setBusy("resend");
    setError(null);
    setNotice(null);
    try {
      await resendVerificationEmail();
      const until = Date.now() + COOLDOWN_MS;
      setCooldownUntil(until);
      setNow(Date.now());
      try {
        sessionStorage.setItem(RESEND_KEY, String(until));
      } catch {
        // The on-screen timer still applies for this view.
      }
      setNotice("Sent. Check your inbox.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the email");
    } finally {
      setBusy(null);
    }
  }

  async function onVerified() {
    if (busy) return;
    setBusy("check");
    setError(null);
    setNotice(null);
    try {
      const verified = await confirmEmailVerified();
      if (!verified) {
        setError("That email isn't verified yet. Check your inbox and try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh your account");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
        Nearby
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">
        Check your inbox to verify your email
      </h1>
      <p className="mt-2 text-sm text-muted">
        We sent a link{user?.email ? ` to ${user.email}` : ""}. Open it, then
        continue here.
      </p>

      {error ? (
        <p className="mt-4 rounded-2xl bg-coral-soft px-3 py-2 text-sm text-coral">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-2xl bg-teal-soft px-3 py-2 text-sm text-teal">
          {notice}
        </p>
      ) : null}

      <div className="mt-8 flex flex-col gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onVerified()}
          className="rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy === "check" ? "Checking…" : "I've verified"}
        </button>
        <button
          type="button"
          disabled={busy !== null || remaining > 0}
          onClick={() => void onResend()}
          className="rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {remaining > 0 ? `Resend email in ${remaining}s` : busy === "resend" ? "Sending…" : "Resend email"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void signOut()}
          className="rounded-2xl px-4 py-3 text-sm font-semibold text-muted disabled:opacity-60"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
