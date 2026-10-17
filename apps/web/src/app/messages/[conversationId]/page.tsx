"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  const bottomRef = useRef<HTMLDivElement>(null);
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
    mutationFn: async () => postMessage(await token(), conversationId, content),
    onSuccess: async () => {
      setContent("");
      await queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      await queryClient.invalidateQueries({ queryKey: ["conversations", user?.uid] });
    },
  });
  const other = conversations.data?.find((row) => row.id === conversationId)?.other;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data?.length]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (content.trim() && !send.isPending) send.mutate();
  }

  async function onBlock() {
    if (!window.confirm("Block this person? They will no longer be able to message you.")) return;
    await blockConversation(await token(), conversationId);
    router.replace("/messages");
  }

  async function onReport() {
    const reason = window.prompt("Briefly tell us what happened.");
    if (!reason) return;
    await reportConversation(await token(), conversationId, reason);
    window.alert("Report received.");
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col bg-card">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-black/5 bg-card/95 px-4 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/messages" className="text-sm font-semibold text-teal">Back</Link>
          <div>
            <h1 className="text-base font-bold text-ink">{other?.name ?? "Conversation"}</h1>
            <p className="text-xs text-muted">Nearby message</p>
          </div>
        </div>
        <div className="flex gap-3 text-xs font-semibold">
          <button type="button" onClick={onReport} className="text-muted">Report</button>
          <button type="button" onClick={onBlock} className="text-coral">Block</button>
        </div>
      </header>

      <main className="flex-1 space-y-3 overflow-y-auto bg-surface px-4 py-6">
        {messages.isLoading ? <p className="text-center text-sm text-muted">Loading messages…</p> : null}
        {messages.isError ? <p className="text-center text-sm text-coral">{messages.error.message}</p> : null}
        {!messages.isLoading && !messages.data?.length ? (
          <p className="text-center text-sm text-muted">Say hello to start the conversation.</p>
        ) : null}
        {messages.data?.map((message) => {
          const mine = message.senderId === user?.uid;
          return (
            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] rounded-3xl px-4 py-2.5 ${mine ? "bg-teal text-white" : "bg-card text-ink shadow-sm"}`}>
                <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                <time className={`mt-1 block text-[10px] ${mine ? "text-white/70" : "text-muted"}`}>
                  {new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </time>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </main>

      <form onSubmit={onSubmit} className="sticky bottom-0 flex gap-2 border-t border-black/5 bg-card p-4">
        <input
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={2_000}
          placeholder="Message"
          aria-label="Message"
          className="min-w-0 flex-1 rounded-full border border-black/10 px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
        />
        <button type="submit" disabled={!content.trim() || send.isPending} className="rounded-full bg-teal px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
          Send
        </button>
      </form>
      {send.error ? <p className="bg-coral-soft px-4 py-2 text-sm text-coral">{send.error.message}</p> : null}
    </div>
  );
}
