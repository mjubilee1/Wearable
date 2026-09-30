"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useAuth } from "@/lib/auth-context";

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send reset email",
      );
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
        Reset password
      </h1>
      <p className="mt-2 text-sm text-muted">
        Enter your email and we&apos;ll send a reset link.
      </p>

      {sent ? (
        <div className="mt-8 space-y-4">
          <p className="rounded-2xl bg-teal-soft px-4 py-3 text-sm text-teal">
            If an account exists for <strong>{email.trim()}</strong>, a reset
            email is on the way. Check your inbox and spam folder.
          </p>
          <Link
            href="/login"
            className="block w-full rounded-2xl bg-teal px-4 py-3 text-center text-sm font-semibold text-white transition hover:brightness-110"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
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
            {submitting ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-teal">
          Sign in
        </Link>
      </p>
    </div>
  );
}
