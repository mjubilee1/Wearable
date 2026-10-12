"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PrivacyFooter } from "@/components/PrivacyFooter";
import { TabBar } from "@/components/TabBar";
import { useAuth } from "@/lib/auth-context";
import {
  CONNECTOR_CATALOG,
  type ConnectorId,
  disconnectGoogleCalendar,
  fetchGoogleCalendarStatus,
  peekPendingAsk,
  readConnectorSetup,
  startGoogleCalendarConnect,
  writeConnectorSetup,
} from "@/lib/connectors";

export function ConnectorsPanel() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<ConnectorId[]>([]);

  useEffect(() => {
    if (!user) return;
    setFavorites(readConnectorSetup(user.uid).favorites);
  }, [user]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const calendar = params.get("calendar");
    if (!calendar) return;
    if (calendar === "connected") {
      void queryClient.invalidateQueries({ queryKey: ["google-calendar"] });
      if (user) {
        const prefs = readConnectorSetup(user.uid);
        const next = Array.from(
          new Set<ConnectorId>([
            ...prefs.favorites,
            "google_calendar",
            "google_tasks",
            "gmail",
          ]),
        );
        writeConnectorSetup(user.uid, {
          favorites: next,
          dismissedAt: prefs.dismissedAt ?? Date.now(),
        });
        setFavorites(next);
      }
    } else if (calendar === "error") {
      setError(
        params.get("reason") === "no_refresh_token"
          ? "Google didn't return a refresh token. Disconnect the app in your Google account and try again."
          : "Could not connect Google.",
      );
    }
    window.history.replaceState({}, "", "/connectors");
    if (calendar === "connected" && peekPendingAsk()) {
      router.replace("/activity");
    }
  }, [queryClient, router, user]);

  const googleQuery = useQuery({
    queryKey: ["google-calendar", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) {
        return { configured: false, connected: false, email: null as string | null };
      }
      return fetchGoogleCalendarStatus(await user.getIdToken());
    },
  });

  const google = googleQuery.data;

  function toggleFavorite(id: ConnectorId) {
    if (!user) return;
    setFavorites((prev) => {
      const next = prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id];
      const prefs = readConnectorSetup(user.uid);
      writeConnectorSetup(user.uid, {
        favorites: next,
        dismissedAt: prefs.dismissedAt ?? Date.now(),
      });
      return next;
    });
  }

  async function connectGoogle() {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      const url = await startGoogleCalendarConnect(await user.getIdToken());
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google connect");
      setBusy(false);
    }
  }

  async function onDisconnectGoogle() {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectGoogleCalendar(await user.getIdToken());
      await queryClient.invalidateQueries({ queryKey: ["google-calendar"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect");
    } finally {
      setBusy(false);
    }
  }

  const googleItems = CONNECTOR_CATALOG.filter((item) => item.googleBundle);
  const otherItems = CONNECTOR_CATALOG.filter((item) => !item.googleBundle);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-16 pt-20 sm:px-8">
      <header className="mb-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
          Nearby
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">
          Connectors
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted sm:text-base">
          Pick what Nearby may use. A spoken request in Talk runs the tool.
        </p>
      </header>

      <main className="flex max-w-xl flex-1 flex-col gap-3">
        {error ? (
          <p className="rounded-2xl bg-coral-soft px-3 py-2 text-sm text-coral">
            {error}
          </p>
        ) : null}

        {googleQuery.isLoading && !google ? (
          <section
            className="rounded-3xl border border-black/5 bg-card px-5 py-5 shadow-sm"
            aria-busy="true"
            aria-label="Loading connectors"
          >
            <div className="h-5 w-28 animate-pulse rounded bg-surface" />
            <div className="mt-3 h-4 w-full animate-pulse rounded bg-surface" />
            <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-surface" />
            <div className="mt-4 space-y-3">
              <div className="h-14 animate-pulse rounded-2xl bg-surface" />
              <div className="h-14 animate-pulse rounded-2xl bg-surface" />
              <div className="h-14 animate-pulse rounded-2xl bg-surface" />
            </div>
          </section>
        ) : (
        <section className="rounded-3xl border border-black/5 bg-card px-5 py-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-ink">Google</h2>
                {google?.connected ? (
                  <span className="rounded-full bg-teal-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal">
                    Connected
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted">
                One connect for Calendar, Tasks, and Gmail read. Reconnect if you
                linked Calendar before Tasks and Gmail were added.
              </p>
              {google?.connected && google.email ? (
                <p className="mt-1 text-xs text-muted">{google.email}</p>
              ) : null}
              {google?.configured === false ? (
                <p className="mt-1 text-xs text-coral">
                  Add Google OAuth keys on the API to enable this.
                </p>
              ) : null}
            </div>
          </div>

          <ul className="mt-4 space-y-3">
            {googleItems.map((item) => {
              const isFavorite = favorites.includes(item.id);
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-surface px-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{item.name}</p>
                    <p className="mt-0.5 text-xs text-muted">{item.canDo}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleFavorite(item.id)}
                    className={[
                      "rounded-full px-3 py-1.5 text-xs font-semibold",
                      isFavorite
                        ? "bg-teal-soft text-teal"
                        : "bg-white text-muted",
                    ].join(" ")}
                  >
                    {isFavorite ? "Favorite" : "Add favorite"}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-4">
            {google?.connected ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDisconnectGoogle()}
                className="rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
              >
                Disconnect Google
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || google?.configured === false}
                onClick={() => void connectGoogle()}
                className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                Connect Google
              </button>
            )}
          </div>
        </section>
        )}

        {otherItems.map((item) => (
          <section
            key={item.id}
            className="rounded-3xl border border-black/5 bg-card px-5 py-5 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-ink">{item.name}</h2>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                    Built in
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{item.canDo}</p>
              </div>
              <div
                role="checkbox"
                aria-checked="true"
                aria-disabled="true"
                className="flex items-center gap-2 rounded-full bg-teal-soft px-3 py-1.5 text-xs font-semibold text-teal"
              >
                <span aria-hidden>✓</span>
                On
              </div>
            </div>
          </section>
        ))}
      </main>

      <PrivacyFooter />
      <TabBar active="connectors" />
    </div>
  );
}
