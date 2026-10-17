"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { messageListTime } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { listConnections } from "@/lib/connections";
import { InvitePanel } from "@/components/InvitePanel";
import { createConversation, getConversations } from "@/lib/phone-messaging";
import { TabBar } from "@/components/TabBar";

export default function MessagesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const conversations = useQuery({
    queryKey: ["conversations", user?.uid],
    enabled: Boolean(user),
    refetchInterval: 5_000,
    queryFn: async () =>
      getConversations(await user!.getIdToken()).then((result) => result.conversations),
  });
  const connections = useQuery({
    queryKey: ["message-connections", user?.uid],
    enabled: Boolean(user) && composing,
    queryFn: () => listConnections(user!.uid),
  });
  const start = useMutation({
    mutationFn: async (recipientId: string) =>
      createConversation(await user!.getIdToken(), recipientId),
    onSuccess: ({ conversation }) => {
      setComposing(false);
      router.push(`/messages/${conversation.id}`);
    },
  });

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = conversations.data ?? [];
    if (!needle) return list;
    return list.filter((row) => {
      const preview = row.lastMessage?.content ?? "";
      return (
        row.other.name.toLowerCase().includes(needle) ||
        preview.toLowerCase().includes(needle)
      );
    });
  }, [conversations.data, query]);

  function openConnection(recipientId: string) {
    const existing = conversations.data?.find((row) => row.other.id === recipientId);
    if (existing) {
      setComposing(false);
      router.push(`/messages/${existing.id}`);
      return;
    }
    start.mutate(recipientId);
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-paper px-4 pb-8 pt-16 sm:px-6">
      <header className="flex items-center justify-between gap-3 py-4">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Messages</h1>
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white"
        >
          New message
        </button>
      </header>

      <label className="relative block">
        <span className="sr-only">Search messages</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          className="w-full rounded-xl border border-black/10 bg-card px-4 py-2.5 text-sm text-ink outline-none ring-teal/30 placeholder:text-muted focus:ring-2"
        />
      </label>

      <main className="mt-3 flex-1 overflow-hidden rounded-2xl border border-black/5 bg-card shadow-sm">
        {conversations.isLoading ? (
          <p className="p-5 text-sm text-muted">Loading conversations…</p>
        ) : conversations.isError ? (
          <div className="space-y-3 p-5">
            <p className="text-sm text-coral">Could not load conversations.</p>
            <button
              type="button"
              onClick={() => conversations.refetch()}
              className="text-sm font-semibold text-teal"
            >
              Try again
            </button>
          </div>
        ) : rows.length ? (
          <ul>
            {rows.map((row) => {
              const mine = row.lastMessage?.senderId === user?.uid;
              const preview = row.lastMessage
                ? `${mine ? "You: " : ""}${row.lastMessage.content}`
                : "Start the conversation";
              return (
                <li key={row.id} className="border-b border-black/5 last:border-0">
                  <Link
                    href={`/messages/${row.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface"
                  >
                    <span
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                      style={{ backgroundColor: `hsl(${row.other.avatarHue} 55% 42%)` }}
                    >
                      {row.other.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[15px] font-semibold text-ink">
                          {row.other.name}
                        </span>
                        {row.lastMessage ? (
                          <time className="shrink-0 text-xs text-muted">
                            {messageListTime(row.lastMessage.createdAt)}
                          </time>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-muted">{preview}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-semibold text-ink">
              {query ? "No chats match that search." : "No conversations yet."}
            </p>
            <p className="mt-1 text-sm text-muted">
              {query
                ? "Try another name."
                : "Invite someone to Nearby, then message them here."}
            </p>
            {!query ? (
              <button
                type="button"
                onClick={() => setComposing(true)}
                className="mt-4 text-sm font-semibold text-teal"
              >
                New message
              </button>
            ) : null}
          </div>
        )}
      </main>

      {composing ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
          <div
            role="dialog"
            aria-labelledby="new-message-title"
            className="flex max-h-[70dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-card shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
              <h2 id="new-message-title" className="text-base font-bold text-ink">
                New message
              </h2>
              <button
                type="button"
                onClick={() => setComposing(false)}
                className="text-sm font-semibold text-teal"
              >
                Cancel
              </button>
            </div>
            <div className="overflow-y-auto p-2">
              {connections.isLoading ? (
                <p className="px-3 py-4 text-sm text-muted">Loading people…</p>
              ) : connections.data?.length ? (
                connections.data.map((row) => (
                  <button
                    key={row.other.id}
                    type="button"
                    disabled={start.isPending}
                    onClick={() => openConnection(row.other.id)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-surface disabled:opacity-60"
                  >
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
                      style={{ backgroundColor: `hsl(${row.other.avatarHue} 55% 42%)` }}
                    >
                      {row.other.initials}
                    </span>
                    <span className="text-sm font-semibold text-ink">{row.other.name}</span>
                  </button>
                ))
              ) : (
                <p className="px-3 py-4 text-sm text-muted">
                  No one to message yet. Send an invite below.
                </p>
              )}
              <InvitePanel />
              {start.error ? (
                <p className="px-3 py-2 text-sm text-coral">{start.error.message}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <TabBar active="messages" />
    </div>
  );
}
