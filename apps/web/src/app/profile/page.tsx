"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { isEmailLikeName } from "@nearby/shared";
import { PendantAccountNote } from "@/components/PendantAccountNote";
import { PlansCard } from "@/components/PlansCard";
import { ReferralCard } from "@/components/ReferralCard";
import { PrivacyFooter } from "@/components/PrivacyFooter";
import { TabBar } from "@/components/TabBar";
import { useAuth } from "@/lib/auth-context";
import { updateUserProfile } from "@/lib/users";

export default function ProfilePage() {
  const { profile, signOut, refreshProfile } = useAuth();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(isEmailLikeName(profile.name, profile.email) ? "" : profile.name);
  }, [profile]);

  if (!profile) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-16 pt-20 sm:px-8">
        <main className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted">Loading profile…</p>
        </main>
        <TabBar active="profile" />
      </div>
    );
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;

    setError(null);
    setMessage(null);

    const trimmed = name.trim();
    if (!trimmed || isEmailLikeName(trimmed, profile.email)) {
      setError("Enter your first name, not your email.");
      return;
    }

    setSaving(true);
    try {
      await updateUserProfile(profile.id, { name: trimmed });
      await refreshProfile();
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-16 pt-20 sm:px-8">
      <header className="mb-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
          Nearby
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">
          Profile
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted sm:text-base">
          Your account. Connect calendar and other tools under Connectors.
        </p>
      </header>

      <main className="max-w-xl flex-1">
        <Suspense fallback={null}>
          <PlansCard />
        </Suspense>
        <ReferralCard />

        <Link
          href="/messages"
          className="mb-6 flex items-center justify-between rounded-3xl border border-black/5 bg-card px-5 py-4 shadow-sm"
        >
          <div>
            <p className="text-sm font-bold text-ink">Messages</p>
            <p className="mt-1 text-sm text-muted">Chat privately with your connections</p>
          </div>
          <span className="text-sm font-semibold text-teal">Open</span>
        </Link>

        <Link
          href="/settings"
          className="mb-6 flex items-center justify-between rounded-3xl border border-black/5 bg-card px-5 py-4 shadow-sm"
        >
          <div>
            <p className="text-sm font-bold text-ink">Account settings</p>
            <p className="mt-1 text-sm text-muted">
              Phone number, privacy, and saved memories
            </p>
          </div>
          <span className="text-sm font-semibold text-teal">Open</span>
        </Link>

        <section className="mb-6 rounded-3xl border border-black/5 bg-card px-5 py-4 shadow-sm">
          <p className="text-sm font-bold text-ink">Pendant</p>
          <PendantAccountNote pendantId={profile.pendantId} className="mt-1 text-sm text-muted" />
        </section>

        <Link
          href="/connectors"
          className="mb-6 flex items-center justify-between rounded-3xl border border-black/5 bg-card px-5 py-4 shadow-sm"
        >
          <div>
            <p className="text-sm font-bold text-ink">Connectors</p>
            <p className="mt-1 text-sm text-muted">
              Favorites and Google Calendar
            </p>
          </div>
          <span className="text-sm font-semibold text-teal">Open</span>
        </Link>

        <form onSubmit={onSave} className="space-y-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">First name</span>
            <input
              required
              value={name}
              autoComplete="given-name"
              placeholder="Your first name"
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
            />
          </label>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-ink">Email</p>
            <p className="rounded-2xl border border-black/10 bg-surface px-4 py-3 text-sm text-muted">
              {profile.email}
            </p>
          </div>

          {error && (
            <p className="rounded-2xl bg-coral-soft px-3 py-2 text-sm text-coral">
              {error}
            </p>
          )}
          {message && (
            <p className="rounded-2xl bg-teal-soft px-3 py-2 text-sm text-teal">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => signOut()}
          className="mt-4 w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm font-semibold text-ink transition hover:bg-surface"
        >
          Sign out
        </button>
      </main>

      <PrivacyFooter />
      <TabBar active="profile" />
    </div>
  );
}
