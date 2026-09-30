"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FacilitateResponse } from "@nearby/shared";
import { DeviceStrip } from "@/components/DeviceStrip";
import { HelloComposer } from "@/components/HelloComposer";
import { ProfileCard } from "@/components/ProfileCard";
import { TabBar } from "@/components/TabBar";
import { useAuth } from "@/lib/auth-context";
import {
  blockedUserIds,
  connectionStatusMap,
  sendConnectionRequest,
} from "@/lib/connections";
import { listNearbyMatches } from "@/lib/users";

const DEMO_STAGES = [15, 55, 85] as const;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function NearbyMatches() {
  const { profile, user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [demoOn, setDemoOn] = useState(false);
  const [demoScore, setDemoScore] = useState(78);
  const [facilitate, setFacilitate] = useState<FacilitateResponse | null>(
    null,
  );
  const [facilitateLoading, setFacilitateLoading] = useState(false);
  const [facilitateError, setFacilitateError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const stageRef = useRef(0);

  const matchesQuery = useQuery({
    queryKey: ["nearby-matches", profile?.id],
    enabled: Boolean(profile),
    queryFn: async () => {
      if (!profile) return [];
      const blocked = await blockedUserIds(profile.id);
      return listNearbyMatches(profile, { excludeIds: blocked });
    },
  });

  const matches = useMemo(
    () => matchesQuery.data ?? [],
    [matchesQuery.data],
  );
  const matchIds = useMemo(() => matches.map((m) => m.id), [matches]);

  const statusQuery = useQuery({
    queryKey: ["connection-status", profile?.id, matchIds.join(",")],
    enabled: Boolean(profile) && matchIds.length > 0,
    queryFn: async () => {
      if (!profile) return new Map();
      return connectionStatusMap(profile.id, matchIds);
    },
  });

  const firstId = matches[0]?.id ?? null;
  const activeId =
    selectedId && matches.some((m) => m.id === selectedId)
      ? selectedId
      : firstId;
  const selected = matches.find((m) => m.id === activeId) ?? matches[0];
  const statusFor = (id: string) => statusQuery.data?.get(id) ?? "none";

  useEffect(() => {
    setFacilitate(null);
    setFacilitateError(null);
    setComposerOpen(false);
    setSendError(null);
  }, [activeId]);

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

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!profile || !activeId) throw new Error("Not ready");
      return sendConnectionRequest({
        from: profile,
        toId: activeId,
        message,
      });
    },
    onSuccess: async () => {
      setComposerOpen(false);
      setSendError(null);
      await queryClient.invalidateQueries({ queryKey: ["connection-status"] });
      await queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (err) => {
      setSendError(err instanceof Error ? err.message : "Could not send hello");
    },
  });

  async function onFacilitate() {
    if (!activeId) return;
    setFacilitateLoading(true);
    setFacilitateError(null);
    try {
      const token = user ? await user.getIdToken() : "dev";
      const res = await fetch(`${API_URL}/v1/facilitate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ otherId: activeId }),
      });
      if (!res.ok) {
        throw new Error(`Could not facilitate (${res.status})`);
      }
      const data = (await res.json()) as FacilitateResponse;
      setFacilitate(data);
    } catch (err) {
      setFacilitateError(
        err instanceof Error ? err.message : "Facilitator unavailable",
      );
    } finally {
      setFacilitateLoading(false);
    }
  }

  const draft =
    facilitate?.icebreakers[0] ??
    (selected
      ? `Hey ${selected.name} — we seem to overlap nearby. Want to connect?`
      : "");

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
            People around you (~40–50 ft). Send a short hello — they review your
            profile and choose whether to connect.
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

      {facilitate || facilitateError ? (
        <aside className="mb-6 max-w-2xl rounded-3xl border border-teal/20 bg-white/80 p-5 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
            Facilitator
            {facilitate ? ` · ${facilitate.mode}` : ""}
          </p>
          {facilitateError ? (
            <p className="mt-2 text-sm text-coral">{facilitateError}</p>
          ) : null}
          {facilitate ? (
            <>
              <p className="mt-2 text-sm text-ink">{facilitate.whyYouVibe}</p>
              <ul className="mt-3 space-y-2">
                {facilitate.icebreakers.map((line) => (
                  <li
                    key={line}
                    className="rounded-2xl bg-teal-soft/50 px-3 py-2 text-sm text-ink"
                  >
                    {line}
                  </li>
                ))}
              </ul>
              {selected && statusFor(selected.id) === "none" ? (
                <button
                  type="button"
                  onClick={() => {
                    setSendError(null);
                    setComposerOpen(true);
                  }}
                  className="mt-4 rounded-2xl bg-teal px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110"
                >
                  Use this · send hello
                </button>
              ) : null}
            </>
          ) : null}
        </aside>
      ) : null}

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
            connectionStatus={statusFor(matchProfile.id)}
            displayScore={
              matchProfile.id === activeId && matchProfile.id === firstId
                ? demoScore
                : undefined
            }
            onSelect={() => setSelectedId(matchProfile.id)}
            onFacilitate={
              matchProfile.id === activeId ? onFacilitate : undefined
            }
            onSayHello={
              matchProfile.id === activeId
                ? () => {
                    setSendError(null);
                    setComposerOpen(true);
                  }
                : undefined
            }
            facilitateLoading={
              matchProfile.id === activeId ? facilitateLoading : false
            }
            style={{ animationDelay: `${index * 60}ms` }}
          />
        ))}
      </main>

      {composerOpen && selected ? (
        <HelloComposer
          name={selected.name}
          initialMessage={draft}
          sending={sendMutation.isPending}
          error={sendError}
          onCancel={() => setComposerOpen(false)}
          onSend={(message) => sendMutation.mutate(message)}
        />
      ) : null}

      <TabBar active="nearby" />
    </div>
  );
}
