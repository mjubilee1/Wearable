"use client";

import { FormEvent, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { captureUtmSource } from "@/lib/attribution";
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
      const source = captureUtmSource();
      await setDoc(
        doc(db, "waitlist", emailDocId(normalized)),
        {
          email: normalized,
          source,
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
      <p className="border border-ink/15 bg-white px-4 py-3 text-sm text-ink">
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
        className="w-full border border-ink/20 bg-white px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-ink"
      />
      <button
        type="submit"
        disabled={status === "saving"}
        className="w-full bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {status === "saving" ? "Joining…" : "Get updates"}
      </button>
      {error ? (
        <p className="text-center text-sm text-coral">{error}</p>
      ) : null}
      <p className="text-xs text-muted">
        No spam. A note when there’s something to try.
      </p>
    </form>
  );
}
