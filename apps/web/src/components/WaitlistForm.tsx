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
      <p className="rounded-2xl bg-teal-soft px-4 py-3 text-center text-sm font-medium text-teal">
        You&apos;re on the list. We&apos;ll email when there&apos;s something
        to try.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-3 text-left">
      <label className="sr-only" htmlFor="waitlist-email">
        Email
      </label>
      <input
        id="waitlist-email"
        type="email"
        required
        autoComplete="email"
        placeholder="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-full border border-teal/20 bg-white px-5 py-3.5 text-sm text-ink outline-none ring-teal/30 placeholder:text-muted focus:ring-2"
      />
      <button
        type="submit"
        disabled={status === "saving"}
        className="w-full rounded-full bg-teal px-5 py-3.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
      >
        {status === "saving" ? "Joining…" : "Get updates"}
      </button>
      {error ? (
        <p className="text-center text-sm text-coral">{error}</p>
      ) : null}
      <p className="text-center text-xs text-muted">
        No spam. A note when there’s something to try.
      </p>
    </form>
  );
}
