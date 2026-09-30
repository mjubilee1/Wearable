"use client";

import { FormEvent, useEffect, useState } from "react";
import { TabBar } from "@/components/TabBar";
import { useAuth } from "@/lib/auth-context";
import { updateUserProfile } from "@/lib/users";

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

export default function ProfilePage() {
  const { profile, signOut, refreshProfile } = useAuth();
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [role, setRole] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setAge(String(profile.age));
    setRole(profile.role);
    setInterests(profile.interests);
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

  function toggleInterest(interest: string) {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest].slice(0, 5),
    );
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;

    setError(null);
    setMessage(null);

    const parsedAge = Number(age);
    if (!Number.isFinite(parsedAge) || parsedAge < 18 || parsedAge > 99) {
      setError("Enter a valid age (18–99).");
      return;
    }

    setSaving(true);
    try {
      await updateUserProfile(profile.id, {
        name,
        age: parsedAge,
        role,
        interests,
      });
      await refreshProfile();
      setMessage("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile");
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
          Your profile
        </h1>
        <p className="mt-2 text-sm text-muted">{profile.email}</p>
      </header>

      <main className="max-w-xl flex-1">
        <div className="mb-5 flex items-center gap-3.5">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold text-white"
            style={{
              background: `linear-gradient(145deg, hsl(${profile.avatarHue} 55% 52%), hsl(${profile.avatarHue} 60% 38%))`,
            }}
          >
            {profile.initials}
          </div>
          <div>
            <p className="font-semibold text-ink">{profile.name}</p>
            <p className="text-sm text-muted">{profile.role}</p>
          </div>
        </div>

        <form onSubmit={onSave} className="space-y-4">
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
                className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
              />
            </label>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-ink">Interests</legend>
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
            {saving ? "Saving…" : "Save profile"}
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

      <TabBar active="profile" />
    </div>
  );
}
