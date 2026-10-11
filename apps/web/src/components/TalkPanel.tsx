"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentMemoryItem,
  AgentPendingTool,
  AgentTurnResponse,
} from "@nearby/shared";
import { TabBar } from "@/components/TabBar";
import { useAuth } from "@/lib/auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function speechRecognition(): SpeechRec | null {
  if (typeof window === "undefined") return null;
  const host = window as Window & {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  const Ctor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = false;
  return rec;
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

export function TalkPanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [pending, setPending] = useState<AgentPendingTool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const recognitionRef = useRef<SpeechRec | null>(null);

  useEffect(() => {
    setCanListen(speechRecognition() !== null);
    return () => window.speechSynthesis?.cancel();
  }, []);

  const memoriesQuery = useQuery({
    queryKey: ["agent-memories", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) return [] as AgentMemoryItem[];
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/v1/agent/memories`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Could not load memories");
      const body = (await res.json()) as { memories: AgentMemoryItem[] };
      return body.memories ?? [];
    },
  });

  async function postTurn(body: Record<string, unknown>) {
    if (!user) throw new Error("Sign in first");
    const token = await user.getIdToken();
    const res = await fetch(`${API_URL}/v1/agent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => null)) as
      | (AgentTurnResponse & { error?: string })
      | null;
    if (!res.ok) {
      throw new Error(payload?.error ?? "The assistant didn't answer");
    }
    if (!payload?.reply) throw new Error("Empty reply");
    return payload;
  }

  async function ask(spoken: string) {
    const next = spoken.trim();
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    setPending(null);
    try {
      const result = await postTurn({ text: next });
      setReply(result.reply);
      setPending(result.pendingTool);
      setText("");
      speak(result.reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not ask");
    } finally {
      setBusy(false);
    }
  }

  function startListening() {
    const rec = speechRecognition();
    if (!rec || busy) return;
    recognitionRef.current = rec;
    setListening(true);
    setError(null);
    rec.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setText(transcript);
      if (transcript.trim()) void ask(transcript);
    };
    rec.onerror = () => {
      setListening(false);
      setError("Couldn't hear that. Type it instead.");
    };
    rec.onend = () => setListening(false);
    try {
      rec.start();
    } catch {
      setListening(false);
      setError("Microphone didn't start. Type it instead.");
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function decide(approved: boolean) {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postTurn({
        decision: {
          tool: pending.tool,
          approved,
          summary: pending.summary,
          payload: pending.payload,
        },
      });
      setReply(result.reply);
      setPending(null);
      speak(result.reply);
      if (approved) {
        await queryClient.invalidateQueries({ queryKey: ["agent-memories"] });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setBusy(false);
    }
  }

  async function forget(id: string) {
    if (!user) return;
    const token = await user.getIdToken();
    const res = await fetch(`${API_URL}/v1/agent/memories/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setError("Could not delete that memory");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["agent-memories"] });
  }

  const memories = memoriesQuery.data ?? [];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-16 pt-20 sm:px-8">
      <header className="mb-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
          Nearby
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">Talk</h1>
        <p className="mt-2 max-w-xl text-sm text-muted sm:text-base">
          One turn, a short answer out loud, then quiet. A note, reminder, or
          memory only happens if you allow it.
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-4">
        <section className="rounded-3xl border border-black/5 bg-card px-5 py-6 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
            Last reply
          </p>
          <p className="mt-3 text-lg font-medium leading-snug text-ink">
            {reply ?? "Tap the microphone, or type what you would say."}
          </p>
          {pending ? (
            <div className="mt-4 rounded-2xl bg-surface px-4 py-3">
              <p className="text-sm text-ink">{pending.summary}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(true)}
                  className="rounded-2xl bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Allow
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(false)}
                  className="rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
                >
                  No
                </button>
              </div>
            </div>
          ) : null}
          {error ? <p className="mt-3 text-sm text-coral">{error}</p> : null}
        </section>

        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(text);
          }}
        >
          <label className="sr-only" htmlFor="talk-text">
            What you would say
          </label>
          <input
            id="talk-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="What's on my calendar today?"
            className="min-w-0 flex-1 rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
          />
          {canListen ? (
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              disabled={busy}
              className="rounded-2xl border border-teal/30 bg-teal-soft px-4 py-3 text-sm font-semibold text-teal disabled:opacity-60"
            >
              {listening ? "Listening…" : "Microphone"}
            </button>
          ) : null}
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Asking…" : "Ask"}
          </button>
        </form>

        <section className="rounded-3xl border border-black/5 bg-card px-5 py-6 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
            Approved memory
          </p>
          {memories.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              Nothing saved. Nearby keeps a fact only after you allow it.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {memories.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded-2xl bg-surface px-3 py-2"
                >
                  <p className="text-sm text-ink">{item.text}</p>
                  <button
                    type="button"
                    onClick={() => void forget(item.id)}
                    className="shrink-0 text-xs font-semibold text-coral"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <TabBar active="activity" />
    </div>
  );
}
