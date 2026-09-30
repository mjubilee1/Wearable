"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  LOOKING_FOR_OPTIONS,
  PROFILE_PROMPT_BANK,
  VIBE_OPTIONS,
  type ProfilePrompt,
} from "@nearby/shared";
import { TabBar } from "@/components/TabBar";
import { useAuth } from "@/lib/auth-context";
import { uploadProfilePhoto } from "@/lib/storage";
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [role, setRole] = useState("");
  const [bio, setBio] = useState("");
  const [lookingFor, setLookingFor] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [vibes, setVibes] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<ProfilePrompt[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setAge(String(profile.age));
    setRole(profile.role);
    setBio(profile.bio ?? "");
    setLookingFor(profile.lookingFor ?? "");
    setInterests(profile.interests);
    setVibes(profile.vibes ?? []);
    setPrompts(profile.prompts ?? []);
    setPhotoUrl(profile.photoUrl ?? null);
    setDeviceId(profile.deviceId ?? "");
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

  function toggleVibe(vibe: string) {
    setVibes((current) =>
      current.includes(vibe)
        ? current.filter((item) => item !== vibe)
        : [...current, vibe].slice(0, 3),
    );
  }

  function addPrompt() {
    if (prompts.length >= 3) return;
    const used = new Set(prompts.map((p) => p.question));
    const nextQ =
      PROFILE_PROMPT_BANK.find((q) => !used.has(q)) ?? PROFILE_PROMPT_BANK[0];
    setPrompts((current) => [
      ...current,
      { id: `local-${Date.now()}`, question: nextQ, answer: "" },
    ]);
  }

  async function onPhotoChange(file: File | undefined) {
    if (!file || !profile) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadProfilePhoto(profile.id, file);
      setPhotoUrl(url);
      await updateUserProfile(profile.id, { photoUrl: url });
      await refreshProfile();
      setMessage("Photo updated.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not upload photo. Check Storage rules.",
      );
    } finally {
      setUploading(false);
    }
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

    const cleanedPrompts = prompts
      .map((p) => ({
        ...p,
        question: p.question.trim(),
        answer: p.answer.trim(),
      }))
      .filter((p) => p.question && p.answer);

    setSaving(true);
    try {
      await updateUserProfile(profile.id, {
        name,
        age: parsedAge,
        role,
        interests,
        bio,
        lookingFor,
        vibes,
        prompts: cleanedPrompts,
        photoUrl,
        deviceId: deviceId.trim().toUpperCase() || null,
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
        <p className="mt-2 max-w-xl text-sm text-muted">
          Share only what you want. Photo, bio, and prompts are voluntary —
          they help walk-by matches feel human.
        </p>
      </header>

      <main className="max-w-xl flex-1">
        <div className="mb-6 flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="group relative h-20 w-20 overflow-hidden rounded-2xl bg-surface shadow-inner"
            aria-label="Upload profile photo"
          >
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span
                className="flex h-full w-full items-center justify-center text-xl font-bold text-white"
                style={{
                  background: `linear-gradient(145deg, hsl(${profile.avatarHue} 55% 52%), hsl(${profile.avatarHue} 60% 38%))`,
                }}
              >
                {profile.initials}
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 bg-black/45 py-1 text-center text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
              {uploading ? "…" : "Edit"}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPhotoChange(e.target.files?.[0])}
          />
          <div>
            <p className="font-semibold text-ink">{profile.name}</p>
            <p className="text-sm text-muted">{profile.email}</p>
          </div>
        </div>

        <form onSubmit={onSave} className="space-y-5">
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

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">
              Bio <span className="font-normal text-muted">(optional)</span>
            </span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 280))}
              rows={3}
              placeholder="A few lines about you — keep it light."
              className="w-full resize-none rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
            />
            <span className="text-[11px] text-muted">{bio.length}/280</span>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">
              Looking for{" "}
              <span className="font-normal text-muted">(optional)</span>
            </span>
            <select
              value={lookingFor}
              onChange={(e) => setLookingFor(e.target.value)}
              className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
            >
              <option value="">Skip for now</option>
              {LOOKING_FOR_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

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

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-ink">
              Vibes <span className="font-normal text-muted">(up to 3)</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {VIBE_OPTIONS.map((vibe) => {
                const active = vibes.includes(vibe);
                return (
                  <button
                    key={vibe}
                    type="button"
                    onClick={() => toggleVibe(vibe)}
                    className={[
                      "rounded-full px-3 py-1.5 text-xs font-medium transition",
                      active
                        ? "bg-ink text-white"
                        : "bg-surface text-muted hover:text-ink",
                    ].join(" ")}
                  >
                    {vibe}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <legend className="text-xs font-semibold text-ink">
                Prompts{" "}
                <span className="font-normal text-muted">(optional)</span>
              </legend>
              <button
                type="button"
                onClick={addPrompt}
                disabled={prompts.length >= 3}
                className="text-xs font-semibold text-teal disabled:opacity-40"
              >
                Add prompt
              </button>
            </div>
            {prompts.map((prompt, index) => (
              <div
                key={prompt.id}
                className="space-y-2 rounded-2xl border border-black/5 bg-card p-3"
              >
                <select
                  value={prompt.question}
                  onChange={(e) =>
                    setPrompts((current) =>
                      current.map((row, i) =>
                        i === index
                          ? { ...row, question: e.target.value }
                          : row,
                      ),
                    )
                  }
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-xs outline-none"
                >
                  {PROFILE_PROMPT_BANK.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
                <textarea
                  value={prompt.answer}
                  onChange={(e) =>
                    setPrompts((current) =>
                      current.map((row, i) =>
                        i === index
                          ? { ...row, answer: e.target.value.slice(0, 160) }
                          : row,
                      ),
                    )
                  }
                  rows={2}
                  placeholder="Your answer…"
                  className="w-full resize-none rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    setPrompts((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                  className="text-[11px] font-medium text-muted hover:text-coral"
                >
                  Remove
                </button>
              </div>
            ))}
          </fieldset>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">
              Wearable ID{" "}
              <span className="font-normal text-muted">
                (optional, e.g. A1B2 from NB-A1B2)
              </span>
            </span>
            <input
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder="A1B2"
              className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 font-mono text-sm uppercase outline-none ring-teal/30 focus:ring-2"
            />
          </label>

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
