"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isEmailLikeName } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import {
  stashPendingAsk,
  startGoogleCalendarConnect,
  writeConnectorSetup,
} from "@/lib/connectors";
import { updateUserProfile } from "@/lib/users";

const FIRST_TASK = "What's my first meeting tomorrow?";
const ONBOARDING_FLAG = "nearby_onboarding";

export default function OnboardingPage() {
  const { user, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    if (!isEmailLikeName(profile.name, profile.email)) setName(profile.name);
  }, [profile]);

  function finishLocally() {
    if (!user) return;
    const dismissedAt = Date.now();
    writeConnectorSetup(user.uid, {
      favorites: ["google_calendar", "google_tasks", "gmail", "notes"],
      dismissedAt,
    });
    void updateUserProfile(user.uid, {
      connectorSetupDismissedAt: dismissedAt,
    }).catch(() => undefined);
    try {
      sessionStorage.removeItem(ONBOARDING_FLAG);
    } catch {
      // Ignore storage failures.
    }
  }

  async function saveName(): Promise<boolean> {
    if (!profile || !user) return false;
    const trimmed = name.trim();
    if (!trimmed || isEmailLikeName(trimmed, profile.email || user.email)) {
      setError("Enter your first name, not your email.");
      return false;
    }
    if (trimmed !== profile.name) {
      await updateUserProfile(profile.id, { name: trimmed });
      await refreshProfile();
    }
    return true;
  }

  async function onConnect(event: FormEvent) {
    event.preventDefault();
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveName();
      if (!saved) {
        setBusy(false);
        return;
      }
      finishLocally();
      stashPendingAsk(FIRST_TASK);
      const url = await startGoogleCalendarConnect(await user.getIdToken(), "demo");
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect Google");
      setBusy(false);
    }
  }

  function onSkip() {
    finishLocally();
    router.replace("/nearby");
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
        Nearby
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">
        Set up Nearby
      </h1>
      <p className="mt-2 text-sm text-muted">
        Add your name, then connect Google if you want.
      </p>
      <form onSubmit={onConnect} className="mt-8 space-y-4">
        <p className="text-sm font-bold text-ink">Optional: connect Google</p>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-ink">First name</span>
          <input
            required
            autoComplete="given-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
          />
        </label>
        {error ? (
          <p className="rounded-2xl bg-coral-soft px-3 py-2 text-sm text-coral">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Opening Google…" : "Connect Google"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSkip}
          className="w-full rounded-2xl border border-black/10 px-4 py-3 text-sm font-semibold text-ink disabled:opacity-60"
        >
          Skip for now
        </button>
      </form>
    </div>
  );
}
