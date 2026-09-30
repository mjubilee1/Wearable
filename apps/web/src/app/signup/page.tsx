"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const INTEREST_OPTIONS = [
  "Coffee walks",
  "Indie film",
  "Climbing",
  "Basketball",
  "Synthwave",
  "Dogs",
  "Farmers markets",
  "Pottery",
  "Jazz",
  "Running",
  "Board games",
  "Thai food",
];

export default function SignupPage() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [age, setAge] = useState("27");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleInterest(interest: string) {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest].slice(0, 5),
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsedAge = Number(age);
    if (!Number.isFinite(parsedAge) || parsedAge < 18 || parsedAge > 99) {
      setError("Enter a valid age (18–99).");
      return;
    }
    if (interests.length < 1) {
      setError("Pick at least one interest.");
      return;
    }

    setSubmitting(true);
    try {
      await signUp({
        email: email.trim(),
        password,
        name,
        age: parsedAge,
        role,
        interests,
      });
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-10">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
        Nearby
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">
        Create your profile
      </h1>
      <p className="mt-2 text-sm text-muted">
        Your vibes power the wearable score light.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-ink">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">Age</span>
            <input
              required
              type="number"
              min={18}
              max={99}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">Role</span>
            <input
              required
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Designer"
              className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
            />
          </label>
        </div>

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

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-ink">
            Interests (up to 5)
          </legend>
          <div className="flex flex-wrap gap-2">
            {INTEREST_OPTIONS.map((interest) => {
              const active = interests.includes(interest);
              return (
                <button
                  key={interest}
                  type="button"
                  onClick={() => toggleInterest(interest)}
                  className={[
                    "rounded-full px-3 py-1.5 text-xs font-medium transition",
                    active
                      ? "bg-teal text-white"
                      : "bg-surface text-muted hover:text-ink",
                  ].join(" ")}
                >
                  {interest}
                </button>
              );
            })}
          </div>
        </fieldset>

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
