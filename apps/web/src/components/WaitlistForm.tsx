"use client";

import { FormEvent, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (email.length > 320) return null;
  return email;
}

function emailDocId(email: string): string {
  return encodeURIComponent(email);
}

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const normalized = normalizeEmail(email);
    if (!normalized) {
      setError("Enter a valid email.");
      setStatus("error");
      return;
    }

    setStatus("saving");
    try {
      await setDoc(
        doc(db, "waitlist", emailDocId(normalized)),
        {
          email: normalized,
          source: "marketing",
          createdAt: Date.now(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setStatus("done");
      setEmail("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not join the waitlist.",
      );
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <p className="rounded-2xl bg-teal-soft px-4 py-3 text-sm font-medium text-teal">
        You&apos;re on the list. We&apos;ll email when there&apos;s something
        to try.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-md flex-col gap-3">
      <label className="sr-only" htmlFor="waitlist-email">
        Email
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="waitlist-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-w-0 flex-1 rounded-full border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
        />
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-full bg-teal px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {status === "saving" ? "Joining…" : "Get updates"}
        </button>
      </div>
      {error ? <p className="text-sm text-coral">{error}</p> : null}
      <p className="text-xs text-muted">
        No spam. Just a note when Nearby is ready to try.
      </p>
    </form>
  );
}
