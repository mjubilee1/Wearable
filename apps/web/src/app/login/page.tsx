"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth-context";
import { useSignupHref } from "@/lib/use-signup-href";

export default function LoginPage() {
  const { signIn } = useAuth();
  const signupHref = useSignupHref();
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
      router.replace("/activity");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <BrandMark className="font-display text-3xl italic text-ink" />
      <h1 className="font-display mt-6 text-4xl font-medium leading-none text-ink">
        Welcome back
      </h1>
      <p className="mt-2 text-sm text-muted">
        Sign in to talk.
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
            className="w-full border border-ink/20 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink"
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
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        New here?{" "}
        <Link href={signupHref} className="font-semibold text-ink underline decoration-teal decoration-2 underline-offset-4">
          Create an account
        </Link>
      </p>
    </div>
  );
}
