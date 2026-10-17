"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { listConnections } from "@/lib/connections";
import { createConversation, getConversations } from "@/lib/phone-messaging";
import { TabBar } from "@/components/TabBar";

export default function MessagesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const conversations = useQuery({
    queryKey: ["conversations", user?.uid],
    enabled: Boolean(user),
    refetchInterval: 5_000,
    queryFn: async () =>
      getConversations(await user!.getIdToken()).then((result) => result.conversations),
  });
  const connections = useQuery({
    queryKey: ["message-connections", user?.uid],
    enabled: Boolean(user),
    queryFn: () => listConnections(user!.uid),
  });
  const start = useMutation({
    mutationFn: async (recipientId: string) =>
      createConversation(await user!.getIdToken(), recipientId),
    onSuccess: ({ conversation }) => router.push(`/messages/${conversation.id}`),
  });
  const existingIds = new Set(
    conversations.data?.map((row) => row.other.id) ?? [],
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-20 pt-16 sm:px-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">Nearby</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">Messages</h1>
        </div>
        <Link href="/activity" className="text-sm font-semibold text-teal">Back to Talk</Link>
      </header>

      <main className="space-y-6">
        <section className="overflow-hidden rounded-3xl border border-black/5 bg-card shadow-sm">
          {conversations.isLoading ? (
            <p className="p-5 text-sm text-muted">Loading conversations…</p>
          ) : conversations.isError ? (
            <p className="p-5 text-sm text-coral">Could not load conversations.</p>
          ) : conversations.data?.length ? (
            conversations.data.map((row) => (
              <Link
                key={row.id}
                href={`/messages/${row.id}`}
                className="flex items-center gap-3 border-b border-black/5 p-4 last:border-0 hover:bg-surface"
              >
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: `hsl(${row.other.avatarHue} 55% 45%)` }}
                >
                  {row.other.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink">{row.other.name}</span>
                  <span className="block truncate text-sm text-muted">
                    {row.lastMessage?.content ?? "Start the conversation"}
                  </span>
                </span>
                {row.lastMessage ? (
                  <time className="text-xs text-muted">
                    {new Date(row.lastMessage.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </time>
                ) : null}
              </Link>
            ))
          ) : (
            <p className="p-5 text-sm text-muted">No conversations yet.</p>
          )}
        </section>

        <section>
          <h2 className="text-sm font-bold text-ink">Start a chat with a connection</h2>
          <div className="mt-3 grid gap-2">
            {connections.data?.filter((row) => !existingIds.has(row.other.id)).map((row) => (
              <button
                type="button"
                key={row.other.id}
                disabled={start.isPending}
                onClick={() => start.mutate(row.other.id)}
                className="flex items-center justify-between rounded-2xl border border-black/10 bg-card px-4 py-3 text-left disabled:opacity-60"
              >
                <span className="text-sm font-semibold text-ink">{row.other.name}</span>
                <span className="text-sm font-semibold text-teal">Message</span>
              </button>
            ))}
            {!connections.isLoading && !connections.data?.length ? (
              <p className="text-sm text-muted">Connect with someone through Nearby before messaging.</p>
            ) : null}
            {start.error ? <p className="text-sm text-coral">{start.error.message}</p> : null}
          </div>
        </section>
      </main>
      <TabBar active="profile" />
    </div>
  );
}
