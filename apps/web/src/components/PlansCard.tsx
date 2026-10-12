"use client";

import { FormEvent, useState } from "react";
import { track } from "@vercel/analytics";
import { useAuth } from "@/lib/auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function PlansCard() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(profile?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onProClick() {
    track("pro_waitlist_click");
    setEmail(profile?.email ?? "");
    setMessage(null);
    setError(null);
    setOpen(true);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/v1/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          source: "pro",
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        alreadyJoined?: boolean;
      } | null;
      if (!res.ok) {
        throw new Error(body?.error ?? "Could not join the waitlist");
      }
      setMessage(
        body?.alreadyJoined
          ? "You're already on the Pro waitlist."
          : "You're on the Pro waitlist. We'll email you when billing opens.",
      );
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-3xl border border-black/5 bg-card px-5 py-6 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
        Plans
      </p>
      <h2 className="mt-1 text-lg font-bold tracking-tight text-ink">
        Free vs Pro
      </h2>
      <p className="mt-2 text-sm text-muted">
        No payments yet. Join the waitlist if you want Pro when it opens.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-surface px-4 py-4">
          <p className="text-sm font-bold text-ink">Free</p>
          <ul className="mt-2 space-y-1.5 text-sm text-muted">
            <li>Example tasks on Talk</li>
            <li>20 requests a day</li>
            <li>Calendar, tasks, unread mail, notes</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-teal/30 bg-teal-soft/40 px-4 py-4">
          <p className="text-sm font-bold text-ink">
            Pro{" "}
            <span className="font-semibold text-teal">$29/mo</span>
          </p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-teal">
            Early access price
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-muted">
            <li>Unlimited requests</li>
            <li>Reschedule and email drafts</li>
            <li>Priority on new connectors</li>
          </ul>
          <button
            type="button"
            onClick={onProClick}
            className="mt-4 w-full rounded-2xl bg-teal px-4 py-2.5 text-sm font-semibold text-white"
          >
            Join Pro waitlist
          </button>
        </div>
      </div>

      {message ? (
        <p className="mt-3 rounded-2xl bg-teal-soft px-3 py-2 text-sm text-teal">
          {message}
        </p>
      ) : null}
      {error && !open ? (
        <p className="mt-3 rounded-2xl bg-coral-soft px-3 py-2 text-sm text-coral">
          {error}
        </p>
      ) : null}

      {open ? (
        <form
          onSubmit={onSubmit}
          className="mt-4 space-y-3 rounded-2xl border border-black/10 bg-surface px-4 py-4"
        >
          <p className="text-sm font-semibold text-ink">Join Pro waitlist</p>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">Email</span>
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
            />
          </label>
          {error ? <p className="text-sm text-coral">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-2xl bg-teal px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Saving…" : "Join waitlist"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
              className="rounded-2xl border border-black/10 bg-card px-4 py-2.5 text-sm font-semibold text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
