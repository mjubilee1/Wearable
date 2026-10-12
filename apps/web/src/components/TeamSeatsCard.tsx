"use client";

// PARITY: mobile — team seat invites are web-only for this phase.

import { FormEvent, useCallback, useEffect, useState } from "react";
import { TEAM_INVITE_LIMIT, normalizePlan } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import {
  fetchTeamState,
  inviteTeamEmail,
  removeTeamEmail,
} from "@/lib/billing";

export function TeamSeatsCard() {
  const { profile } = useAuth();
  const [emails, setEmails] = useState<string[]>([]);
  const [remaining, setRemaining] = useState(TEAM_INVITE_LIMIT);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = profile ? normalizePlan(profile.plan) === "team" : false;

  const reload = useCallback(async () => {
    if (!isOwner) return;
    try {
      const state = await fetchTeamState();
      setEmails(state.memberEmails);
      setRemaining(state.remaining);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load team");
    }
  }, [isOwner]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!profile || !isOwner) return null;

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await inviteTeamEmail(email);
      setEmails(result.memberEmails);
      setRemaining(Math.max(0, TEAM_INVITE_LIMIT - result.memberEmails.length));
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(member: string) {
    setError(null);
    setBusy(true);
    try {
      const result = await removeTeamEmail(member);
      setEmails(result.memberEmails);
      setRemaining(Math.max(0, TEAM_INVITE_LIMIT - result.memberEmails.length));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-3xl border border-black/5 bg-card px-5 py-6 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
        Team seats
      </p>
      <h2 className="mt-1 text-lg font-bold tracking-tight text-ink">
        Invite up to {TEAM_INVITE_LIMIT}
      </h2>
      <p className="mt-2 text-sm text-muted">
        Teammates who sign in with the invited email get Pro through your team.
        {remaining === 1 ? " 1 seat left." : ` ${remaining} seats left.`}
      </p>

      <form onSubmit={onInvite} className="mt-4 flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          className="min-w-0 flex-1 rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
        />
        <button
          type="submit"
          disabled={busy || remaining <= 0}
          className="rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          Invite
        </button>
      </form>

      {error ? (
        <p className="mt-3 rounded-2xl bg-coral-soft px-3 py-2 text-sm text-coral">
          {error}
        </p>
      ) : null}

      {emails.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {emails.map((member) => (
            <li
              key={member}
              className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-3 py-2 text-sm"
            >
              <span className="truncate text-ink">{member}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onRemove(member)}
                className="shrink-0 text-sm font-semibold text-coral disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted">No invites yet.</p>
      )}
    </section>
  );
}
