"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { isEmailLikeName } from "@nearby/shared";
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
      <div className="app-shell mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pb-16 pt-20">
        <main className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted">Loading…</p>
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
    <div className="app-shell mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pb-16 pt-20">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Profile
        </h1>
        <p className="mt-1 text-sm text-muted">
          Your name and email for this account.
        </p>
      </header>

      <main className="flex max-w-md flex-1 flex-col">
        <form onSubmit={onSave} className="space-y-5">
          <label className="block space-y-1.5">
            <span className="text-sm text-muted">First name</span>
            <input
              required
              value={name}
              autoComplete="given-name"
              placeholder="Your first name"
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>

          <div className="space-y-1.5">
            <p className="text-sm text-muted">Email</p>
            <p className="border border-ink/10 bg-surface px-3 py-2.5 text-sm text-ink">
              {profile.email}
            </p>
          </div>

          {error ? <p className="text-sm text-coral">{error}</p> : null}
          {message ? <p className="text-sm text-teal">{message}</p> : null}

          <button
            type="submit"
            disabled={saving}
            className="bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>

        <div className="mt-10 border-t border-ink/10 pt-6">
          <Link
            href="/settings"
            className="flex items-center justify-between gap-3 py-1 text-sm text-ink hover:text-ink/70"
          >
            <span>
              <span className="font-medium">Settings</span>
              <span className="mt-0.5 block text-muted">
                Sensing, memory, and preferences
              </span>
            </span>
            <span aria-hidden className="text-muted">
              →
            </span>
          </Link>
        </div>

        <button
          type="button"
          onClick={() => signOut()}
          className="mt-8 self-start border border-ink/15 px-4 py-2.5 text-sm text-ink hover:bg-surface"
        >
          Sign out
        </button>
      </main>

      <PrivacyFooter />
      <TabBar active="profile" />
    </div>
  );
}
