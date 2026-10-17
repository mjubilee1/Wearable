"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { groupChatMessages, messageClock, type Message } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import {
  blockConversation,
  getConversations,
  getMessages,
  postMessage,
  reportConversation,
} from "@/lib/phone-messaging";

export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [content, setContent] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const token = () => user!.getIdToken();

  const conversations = useQuery({
    queryKey: ["conversations", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => getConversations(await token()).then((r) => r.conversations),
  });
  const messages = useQuery({
    queryKey: ["messages", conversationId],
    enabled: Boolean(user && conversationId),
    refetchInterval: 3_000,
    queryFn: async () => getMessages(await token(), conversationId).then((r) => r.messages),
  });
  const send = useMutation({
    mutationFn: async (text: string) => postMessage(await token(), conversationId, text),
    onMutate: async (text) => {
      setContent("");
      await queryClient.cancelQueries({ queryKey: ["messages", conversationId] });
      const previous = queryClient.getQueryData<Message[]>(["messages", conversationId]);
      const optimistic: Message = {
        id: `pending-${Date.now()}`,
        conversationId,
        senderId: user?.uid ?? "",
        recipientId: "",
        content: text,
        messageType: "TEXT",
        deliveryStatus: "SENT",
        createdAt: Date.now(),
      };
      queryClient.setQueryData<Message[]>(["messages", conversationId], [
        ...(previous ?? []),
        optimistic,
      ]);
      return { previous, text };
    },
    onError: (_error, _text, context) => {
      if (context?.text) setContent(context.text);
      if (context?.previous) {
        queryClient.setQueryData(["messages", conversationId], context.previous);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      await queryClient.invalidateQueries({ queryKey: ["conversations", user?.uid] });
    },
  });
  const other = conversations.data?.find((row) => row.id === conversationId)?.other;
  const groups = groupChatMessages(messages.data ?? []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data?.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  function onSubmit(event?: FormEvent) {
    event?.preventDefault();
    const text = content.trim();
    if (!text || send.isPending) return;
    send.mutate(text);
  }

  async function onBlock() {
    setMenuOpen(false);
    if (!window.confirm("Block this person? They will no longer be able to message you.")) return;
    await blockConversation(await token(), conversationId);
    router.replace("/messages");
  }

  async function onReport() {
    setMenuOpen(false);
    const reason = window.prompt("Briefly tell us what happened.");
    if (!reason) return;
    await reportConversation(await token(), conversationId, reason);
    window.alert("Report received.");
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-xl flex-col bg-surface">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-black/5 bg-card/95 px-3 py-3 backdrop-blur">
        <Link
          href="/messages"
          aria-label="Back to messages"
          className="flex h-9 w-9 items-center justify-center rounded-full text-lg font-semibold text-teal hover:bg-surface"
        >
          ‹
        </Link>
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: `hsl(${other?.avatarHue ?? 168} 55% 42%)` }}
        >
          {other?.initials ?? "•"}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold text-ink">
            {other?.name ?? "Conversation"}
          </h1>
          <p className="text-xs text-muted">Message</p>
        </div>
        <div className="relative">
          <button
            type="button"
            aria-label="Conversation actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-muted hover:bg-surface"
          >
            ···
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-10 z-20 w-36 overflow-hidden rounded-2xl border border-black/5 bg-card py-1 shadow-lg">
              <button
                type="button"
                onClick={onReport}
                className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-surface"
              >
                Report
              </button>
              <button
                type="button"
                onClick={onBlock}
                className="block w-full px-4 py-2.5 text-left text-sm text-coral hover:bg-surface"
              >
                Block
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {messages.isLoading ? (
          <p className="text-center text-sm text-muted">Loading messages…</p>
        ) : null}
        {messages.isError ? (
          <div className="text-center">
            <p className="text-sm text-coral">{messages.error.message}</p>
            <button
              type="button"
              onClick={() => messages.refetch()}
              className="mt-2 text-sm font-semibold text-teal"
            >
              Try again
            </button>
          </div>
        ) : null}
        {!messages.isLoading && !messages.data?.length ? (
          <p className="px-6 pt-10 text-center text-sm text-muted">
            Say hello to start the conversation.
          </p>
        ) : null}
        {groups.map((group) => (
          <section key={group.day} className="space-y-3">
            <p className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
              {group.day}
            </p>
            {group.clusters.map((cluster) => {
              const mine = cluster.senderId === user?.uid;
              return (
                <div key={cluster.messages[0]?.id} className="space-y-0.5">
                  {cluster.messages.map((message, index) => {
                    const last = index === cluster.messages.length - 1;
                    const pending = message.id.startsWith("pending-");
                    return (
                      <div
                        key={message.id}
                        className={`flex ${mine ? "justify-end" : "justify-start"} ${pending ? "opacity-70" : ""}`}
                      >
                        <div
                          className={[
                            "max-w-[78%] px-3.5 py-2 text-[15px] leading-snug",
                            mine
                              ? "bg-teal text-white"
                              : "bg-card text-ink shadow-sm",
                            mine
                              ? last
                                ? "rounded-2xl rounded-br-md"
                                : "rounded-2xl"
                              : last
                                ? "rounded-2xl rounded-bl-md"
                                : "rounded-2xl",
                          ].join(" ")}
                        >
                          <p className="whitespace-pre-wrap break-words">{message.content}</p>
                          {last ? (
                            <time
                              className={`mt-1 block text-[10px] ${mine ? "text-white/70" : "text-muted"}`}
                            >
                              {pending ? "Sending…" : messageClock(message.createdAt)}
                            </time>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>
        ))}
        <div ref={bottomRef} />
      </main>

      {send.error ? (
        <p className="bg-coral-soft px-4 py-2 text-sm text-coral">{send.error.message}</p>
      ) : null}
      <form
        onSubmit={onSubmit}
        className="sticky bottom-0 flex items-end gap-2 border-t border-black/5 bg-card px-3 py-3"
      >
        <textarea
          ref={inputRef}
          value={content}
          rows={1}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          maxLength={2_000}
          placeholder="Message"
          aria-label="Message"
          className="max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-3xl border border-black/10 bg-surface px-4 py-2.5 text-[15px] outline-none ring-teal/30 focus:ring-2"
        />
        <button
          type="submit"
          disabled={!content.trim() || send.isPending}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal text-sm font-semibold text-white disabled:opacity-40"
          aria-label="Send"
        >
          ↑
        </button>
      </form>
    </div>
  );
}
