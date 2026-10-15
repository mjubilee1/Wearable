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
      <Link href="/" className="font-display text-3xl italic text-ink">
        nearby
      </Link>
      <h1 className="font-display mt-6 text-4xl font-medium leading-none text-ink">
        Reset password
      </h1>
      <p className="mt-2 text-sm text-muted">
        Enter your email and we&apos;ll send a reset link.
      </p>

      {sent ? (
        <div className="mt-8 space-y-4">
          <p className="border border-teal/30 bg-teal-soft px-4 py-3 text-sm text-teal">
            If an account exists for <strong>{email.trim()}</strong>, a reset
            email is on the way. Check your inbox and spam folder.
          </p>
          <Link
            href="/login"
            className="block w-full bg-ink px-4 py-3 text-center text-sm font-semibold text-white"
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
            {submitting ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-ink underline decoration-teal decoration-2 underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
