"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicProfileCard } from "@/components/PublicProfileCard";
import { TabBar } from "@/components/TabBar";
import { useAuth } from "@/lib/auth-context";
import {
  acceptConnectionRequest,
  blockUser,
  cancelConnectionRequest,
  declineConnectionRequest,
  listConnections,
  listIncomingRequests,
  listOutgoingRequests,
  type RequestWithProfile,
} from "@/lib/connections";

type Tab = "incoming" | "sent" | "connected";

export default function ConnectionsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("incoming");
  const [actionError, setActionError] = useState<string | null>(null);

  const incomingQuery = useQuery({
    queryKey: ["connections", "incoming", profile?.id],
    enabled: Boolean(profile),
    queryFn: () => listIncomingRequests(profile!.id),
  });

  const sentQuery = useQuery({
    queryKey: ["connections", "sent", profile?.id],
    enabled: Boolean(profile),
    queryFn: () => listOutgoingRequests(profile!.id),
  });

  const connectedQuery = useQuery({
    queryKey: ["connections", "connected", profile?.id],
    enabled: Boolean(profile),
    queryFn: () => listConnections(profile!.id),
  });

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["connections"] }),
      queryClient.invalidateQueries({ queryKey: ["connection-status"] }),
      queryClient.invalidateQueries({ queryKey: ["nearby-matches"] }),
    ]);
  }

  const acceptMutation = useMutation({
    mutationFn: (requestId: string) =>
      acceptConnectionRequest(requestId, profile!.id),
    onSuccess: refreshAll,
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Could not accept"),
  });

  const declineMutation = useMutation({
    mutationFn: (requestId: string) =>
      declineConnectionRequest(requestId, profile!.id),
    onSuccess: refreshAll,
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Could not decline"),
  });

  const cancelMutation = useMutation({
    mutationFn: (requestId: string) =>
      cancelConnectionRequest(requestId, profile!.id),
    onSuccess: refreshAll,
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Could not cancel"),
  });

  const blockMutation = useMutation({
    mutationFn: (blockedId: string) => blockUser(profile!.id, blockedId),
    onSuccess: refreshAll,
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Could not block"),
  });

  const busy =
    acceptMutation.isPending ||
    declineMutation.isPending ||
    cancelMutation.isPending ||
    blockMutation.isPending;

  const tabs: { id: Tab; label: string; count: number }[] = [
    {
      id: "incoming",
      label: "Incoming",
      count: incomingQuery.data?.length ?? 0,
    },
    { id: "sent", label: "Sent", count: sentQuery.data?.length ?? 0 },
    {
      id: "connected",
      label: "Connected",
      count: connectedQuery.data?.length ?? 0,
    },
  ];

  const rows: RequestWithProfile[] =
    tab === "incoming"
      ? (incomingQuery.data ?? [])
      : tab === "sent"
        ? (sentQuery.data ?? [])
        : (connectedQuery.data ?? []);

  const loading =
    (tab === "incoming" && incomingQuery.isLoading) ||
    (tab === "sent" && sentQuery.isLoading) ||
    (tab === "connected" && connectedQuery.isLoading);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-16 pt-20 sm:px-8">
      <header className="mb-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
          Nearby
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">
          Connections
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted sm:text-base">
          Hellos you’ve received, sent, and people you’ve mutually linked with.
          Decline is quiet — they won’t be notified.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setActionError(null);
            }}
            className={[
              "rounded-full px-4 py-2 text-sm font-semibold transition",
              tab === item.id
                ? "bg-teal text-white"
                : "bg-card text-muted shadow-sm hover:text-ink",
            ].join(" ")}
          >
            {item.label}
            {item.count > 0 ? (
              <span className="ml-1.5 tabular-nums opacity-80">
                {item.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {actionError ? (
        <p className="mb-4 rounded-2xl bg-coral-soft px-4 py-3 text-sm text-coral">
          {actionError}
        </p>
      ) : null}

      <main className="grid flex-1 gap-4 sm:grid-cols-2">
        {loading ? (
          <p className="rounded-3xl bg-card px-4 py-8 text-center text-sm text-muted sm:col-span-2">
            Loading…
          </p>
        ) : null}

        {!loading && rows.length === 0 ? (
          <p className="rounded-3xl bg-card px-5 py-10 text-center text-sm text-muted sm:col-span-2">
            {tab === "incoming"
              ? "No hellos waiting. When someone nearby reaches out, you’ll review their profile here."
              : tab === "sent"
                ? "You haven’t sent a hello yet. Pick someone on Nearby and send a short intro."
                : "No connections yet. Accept a hello to start a mutual link."}
          </p>
        ) : null}

        {rows.map(({ request, other }) => (
          <PublicProfileCard
            key={`${tab}-${request.id}-${other.id}`}
            profile={other}
            message={
              tab === "incoming" || tab === "sent"
                ? request.message
                : undefined
            }
            footer={
              tab === "incoming" ? (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setActionError(null);
                        declineMutation.mutate(request.id);
                      }}
                      className="flex-1 rounded-2xl border border-black/10 px-3 py-2.5 text-sm font-semibold text-muted transition hover:bg-surface disabled:opacity-60"
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setActionError(null);
                        acceptMutation.mutate(request.id);
                      }}
                      className="flex-1 rounded-2xl bg-teal px-3 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                    >
                      Accept
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setActionError(null);
                      blockMutation.mutate(other.id);
                    }}
                    className="text-xs font-medium text-coral hover:underline disabled:opacity-60"
                  >
                    Block · hide from Nearby
                  </button>
                </div>
              ) : tab === "sent" ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted">
                    Waiting for them to review your profile
                  </p>
                  {request.status === "pending" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setActionError(null);
                        cancelMutation.mutate(request.id);
                      }}
                      className="shrink-0 text-xs font-semibold text-muted hover:text-ink disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs font-medium text-teal">
                  Connected · chat coming soon
                </p>
              )
            }
          />
        ))}
      </main>

      <TabBar active="connections" />
    </div>
  );
}
