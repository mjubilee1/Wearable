"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
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
        Welcome back
      </h1>
      <p className="mt-2 text-sm text-muted">
        Sign in to see who&apos;s around you.
      </p>

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
        <label className="block space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-ink">Password</span>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-teal hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <input
            type="password"
            required
            minLength={6}
            autoComplete="current-password"
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
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-teal">
          Create an account
        </Link>
      </p>
    </div>
  );
}
