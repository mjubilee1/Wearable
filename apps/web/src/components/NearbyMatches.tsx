"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DeviceStrip } from "@/components/DeviceStrip";
import { ProfileCard } from "@/components/ProfileCard";
import { TabBar } from "@/components/TabBar";
import { useAuth } from "@/lib/auth-context";
import { listNearbyMatches } from "@/lib/users";

const DEMO_STAGES = [15, 55, 85] as const;

export function NearbyMatches() {
  const { profile } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [demoOn, setDemoOn] = useState(false);
  const [demoScore, setDemoScore] = useState(78);
  const stageRef = useRef(0);

  const matchesQuery = useQuery({
    queryKey: ["nearby-matches", profile?.id],
    enabled: Boolean(profile),
    queryFn: async () => {
      if (!profile) return [];
      return listNearbyMatches(profile);
    },
  });

  const matches = matchesQuery.data ?? [];
  const firstId = matches[0]?.id ?? null;
  const activeId = selectedId && matches.some((m) => m.id === selectedId)
    ? selectedId
    : firstId;
  const selected = matches.find((m) => m.id === activeId) ?? matches[0];

  useEffect(() => {
    if (!selected) return;

    if (!demoOn) {
      setDemoScore(selected.score);
      stageRef.current = 0;
      return;
    }

    stageRef.current = 0;
    setDemoScore(DEMO_STAGES[0]);

    const id = window.setInterval(() => {
      stageRef.current = (stageRef.current + 1) % DEMO_STAGES.length;
      setDemoScore(DEMO_STAGES[stageRef.current]);
    }, 1800);

    return () => window.clearInterval(id);
  }, [demoOn, selected]);

  const displayScore =
    selected && activeId === firstId ? demoScore : (selected?.score ?? 0);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-16 pt-20 sm:px-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
            Nearby
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Nearby Matches
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted sm:text-base">
            People around you (~40–50 ft). Open the mobile app for the native
            proximity experience.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-teal/30 bg-teal-soft/40 px-3.5 py-3 sm:min-w-[240px]">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink">Walk-by demo</p>
            <p className="text-[11px] text-muted">
              Animate score 15% → 55% → 85%
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={demoOn}
            onClick={() => setDemoOn((v) => !v)}
            className={[
              "relative h-8 w-14 shrink-0 rounded-full transition-colors duration-300",
              demoOn ? "bg-teal" : "bg-gray-300",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform duration-300",
                demoOn ? "translate-x-6" : "translate-x-0",
              ].join(" ")}
            />
            <span className="sr-only">Toggle walk-by score demo</span>
          </button>
        </div>
      </header>

      <div className="mb-6 max-w-md">
        <DeviceStrip score={displayScore} />
      </div>

      <main className="grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {matchesQuery.isLoading && (
          <p className="rounded-3xl bg-card px-4 py-8 text-center text-sm text-muted sm:col-span-2 lg:col-span-3">
            Scanning nearby…
          </p>
        )}

        {matchesQuery.isError && (
          <p className="rounded-3xl bg-coral-soft px-4 py-6 text-center text-sm text-coral sm:col-span-2 lg:col-span-3">
            Could not load matches. Check Firestore rules and try again.
          </p>
        )}

        {!matchesQuery.isLoading && matches.length === 0 && (
          <p className="rounded-3xl bg-card px-4 py-8 text-center text-sm text-muted sm:col-span-2 lg:col-span-3">
            No one nearby yet. Invite a friend to sign up.
          </p>
        )}

        {matches.map((matchProfile, index) => (
          <ProfileCard
            key={matchProfile.id}
            profile={matchProfile}
            selected={matchProfile.id === activeId}
            displayScore={
              matchProfile.id === activeId && matchProfile.id === firstId
                ? demoScore
                : undefined
            }
            onSelect={() => setSelectedId(matchProfile.id)}
            style={{ animationDelay: `${index * 60}ms` }}
          />
        ))}
      </main>

      <TabBar active="nearby" />
    </div>
  );
}
