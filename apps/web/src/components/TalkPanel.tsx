"use client";

// PARITY: mobile — spoken Done receipt, notes delete, confirm previews.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEVICE_LOCATION_OFF,
  FREE_DAILY_REQUESTS,
  isLimitReachedBody,
  isPlaceholderNote,
  turnNeedsDeviceLocation,
  type AgentActionReceipt,
  type AgentConfirmPreview,
  type AgentDraftChoicesPreview,
  type AgentDraftPreview,
  type AgentHistoryItem,
  type AgentMemoryItem,
  type AgentPendingTool,
  type AgentReschedulePreview,
  type AgentTurnResponse,
  type AgentUsageStatus,
  type LimitReachedBody,
} from "@nearby/shared";
import { TabBar } from "@/components/TabBar";
import { UpgradeSheet } from "@/components/UpgradeSheet";
import { useAuth } from "@/lib/auth-context";
import {
  clearPendingAsk,
  fetchGoogleCalendarStatus,
  peekPendingAsk,
  stashPendingAsk,
  startGoogleCalendarConnect,
} from "@/lib/connectors";
import { locationForTurn, offerDeviceLocationOnce } from "@/lib/device-location";
import { updateUserProfile } from "@/lib/users";
import { trackFunnel } from "@/lib/funnel";
import { CONNECTOR_PRIVACY_LINE } from "@/lib/site";
import { PendantAccountNote } from "@/components/PendantAccountNote";
import { VoiceMemoPanel } from "@/components/VoiceMemoPanel";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const EXAMPLES = [
  {
    id: "calendar-today",
    text: "What's on my calendar today?",
    needsGoogle: true,
  },
  {
    id: "tasks",
    text: "Remind me to follow up with the Johnsons Friday",
    needsGoogle: true,
  },
  {
    id: "gmail",
    text: "Summarize unread emails from title and escrow",
    needsGoogle: true,
  },
] as const;

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

type AgentNoteItem = { id: string; text: string; createdAt: number };

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

function unlockSpeech() {
  try {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.resume();
    const warmup = new SpeechSynthesisUtterance(" ");
    warmup.volume = 0;
    window.speechSynthesis.speak(warmup);
  } catch {
    // Speech is optional. The reply still shows as text.
  }
}

function speak(text: string) {
  try {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Speech is optional. The reply still shows as text.
  }
}

function formatNoteTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function friendlyAgentError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (/sign in/i.test(raw)) return "Sign in again, then retry.";
  if (/failed to fetch|network/i.test(raw)) {
    return "Couldn't reach Nearby. Check your connection and retry.";
  }
  if (/isn't configured/i.test(raw)) return "Google connect isn't available right now.";
  if (raw && raw.length < 140) return raw;
  return "That didn't go through. Retry in a moment.";
}

function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

function ReceiptLine({ receipt }: { receipt: AgentActionReceipt }) {
  const href = safeHref(receipt.href);
  return (
    <p className="mt-2 text-sm text-ink">
      <span className="font-semibold text-teal">Done:</span> {receipt.action}
      {href ? (
        <>
          {" "}
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-teal underline"
          >
            {receipt.linkLabel ?? "Open"}
          </a>
        </>
      ) : null}
    </p>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[75%] whitespace-pre-wrap break-words rounded-3xl bg-black/[0.06] px-4 py-2.5 text-[15px] leading-snug text-ink">
        {text}
      </p>
    </div>
  );
}

function NearbyBubble({
  children,
  time,
}: {
  children: ReactNode;
  time?: string;
}) {
  return (
    <div className="pr-6">
      <div className="text-[16px] leading-7 text-ink">{children}</div>
      {time ? <time className="mt-1.5 block text-[11px] text-muted">{time}</time> : null}
    </div>
  );
}

export function TalkPanel() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<AgentActionReceipt | null>(null);
  const [pending, setPending] = useState<AgentPendingTool | null>(null);
  const [preview, setPreview] = useState<AgentConfirmPreview | null>(null);
  const [draftEdit, setDraftEdit] = useState<AgentDraftPreview | null>(null);
  const [editingDraft, setEditingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const [usage, setUsage] = useState<AgentUsageStatus | null>({
    plan: "free",
    limit: FREE_DAILY_REQUESTS,
    used: 0,
    remaining: FREE_DAILY_REQUESTS,
  });
  const [limitHit, setLimitHit] = useState<LimitReachedBody | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [library, setLibrary] = useState<"memory" | "notes" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const recognitionRef = useRef<SpeechRec | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const timeZone = browserTimeZone();

  useEffect(() => {
    setCanListen(speechRecognition() !== null);
    return () => window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    if (!user || !profile) return;
    if (profile.timeZone === timeZone) return;
    void updateUserProfile(user.uid, { timeZone }).catch(() => {
      // API also persists timezone on each agent turn.
    });
  }, [profile, timeZone, user]);

  const historyQuery = useQuery({
    queryKey: ["agent-history", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) {
        return {
          history: [] as AgentHistoryItem[],
          usage: null as AgentUsageStatus | null,
        };
      }
      const token = await user.getIdToken();
      const res = await fetch(
        `${API_URL}/v1/agent/history?timeZone=${encodeURIComponent(browserTimeZone())}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) throw new Error("Could not load history");
      const body = (await res.json()) as {
        history: AgentHistoryItem[];
        usage: AgentUsageStatus;
      };
      return {
        history: body.history ?? [],
        usage: body.usage ?? null,
      };
    },
  });

  useEffect(() => {
    if (!historyQuery.data?.usage) return;
    setUsage(historyQuery.data.usage);
  }, [historyQuery.data]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [
    historyQuery.data?.history.length,
    reply,
    busy,
    pending,
    preview,
    error,
    library,
  ]);

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

  const notesQuery = useQuery({
    queryKey: ["agent-notes", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) return [] as AgentNoteItem[];
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/v1/agent/notes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Could not load notes");
      const body = (await res.json()) as { notes: AgentNoteItem[] };
      return (body.notes ?? []).filter((note) => !isPlaceholderNote(note.text));
    },
  });

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

  useEffect(() => {
    if (!user || !googleQuery.data?.connected) return;
    trackFunnel("google_connected", { plan: usage?.plan ?? "free" }, {
      scope: "local",
      key: `google_connected:${user.uid}`,
    });
  }, [googleQuery.data?.connected, usage?.plan, user]);

  function applyTurn(result: AgentTurnResponse, requestText?: string) {
    setReply(result.reply);
    setReceipt(result.receipt ?? null);
    setPending(result.pendingTool);
    setPreview(result.preview ?? null);
    setHistoryId(result.historyId ?? null);
    if (result.preview?.kind === "draft_email") {
      setDraftEdit(result.preview);
      setEditingDraft(false);
    } else {
      setDraftEdit(null);
      setEditingDraft(false);
    }
    if (result.usage) setUsage(result.usage);
    if (requestText) setLastRequest(requestText);
    if (user) {
      trackFunnel("first_task_done", { plan: result.usage?.plan ?? "free" }, {
        scope: "local",
        key: `first_task_done:${user.uid}`,
      });
    }
    speak(result.reply);
  }

  function noteLimit(payload: unknown): boolean {
    if (!isLimitReachedBody(payload)) return false;
    setLimitHit(payload);
    trackFunnel(
      "limit_reached",
      { plan: "free", feature: payload.feature },
      {
        scope: "session",
        key: `limit_reached:${payload.feature}:${payload.resetAt}`,
      },
    );
    return true;
  }

  const ask = useCallback(
    async (spoken: string) => {
      const next = spoken.trim();
      if (!next || busy || !user) return;
      const needsLocation = turnNeedsDeviceLocation(next);
      const locationPromise = locationForTurn(needsLocation);
      setLastRequest(next);
      setBusy(true);
      setError(null);
      setReply(null);
      setReceipt(null);
      setPending(null);
      setPreview(null);
      setDraftEdit(null);
      try {
        const location = await locationPromise;
        setLocationNote(needsLocation && !location ? DEVICE_LOCATION_OFF : null);
        const token = await user.getIdToken();
        const res = await fetch(`${API_URL}/v1/agent`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: next,
            timeZone,
            ...(location ? { location } : {}),
          }),
        });
        const payload = (await res.json().catch(() => null)) as
          | (AgentTurnResponse & { error?: string })
          | null;
        if (!res.ok) {
          if (noteLimit(payload)) return;
          throw new Error(payload?.error ?? "Nearby didn't answer");
        }
        if (!payload?.reply) throw new Error("Nearby didn't answer");
        applyTurn(payload, next);
        setText("");
        await queryClient.invalidateQueries({ queryKey: ["agent-memories"] });
        await queryClient.invalidateQueries({ queryKey: ["agent-notes"] });
        await queryClient.invalidateQueries({ queryKey: ["agent-history"] });
      } catch (err) {
        setError(friendlyAgentError(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, queryClient, timeZone, user],
  );

  useEffect(() => {
    let cancelled = false;
    if (!user || googleQuery.isLoading) return;
    const pendingAsk = peekPendingAsk();
    if (!pendingAsk) return;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      clearPendingAsk();
      const match = EXAMPLES.find((item) => item.text === pendingAsk);
      const needsGoogle = match?.needsGoogle ?? true;
      if (needsGoogle && !googleQuery.data?.connected) {
        setLastRequest(pendingAsk);
        setError("Google didn't connect. Tap the example again when you're ready.");
        return;
      }
      await ask(pendingAsk);
    })();
    return () => {
      cancelled = true;
    };
  }, [ask, googleQuery.data, googleQuery.isLoading, user]);

  async function onExample(example: (typeof EXAMPLES)[number]) {
    if (busy || !user || googleQuery.isLoading) return;
    unlockSpeech();
    const status = googleQuery.data;
    if (
      example.needsGoogle &&
      status?.configured !== false &&
      !status?.connected
    ) {
      setLastRequest(example.text);
      setBusy(true);
      setError(null);
      setReply(null);
      setReceipt(null);
      try {
        stashPendingAsk(example.text);
        const url = await startGoogleCalendarConnect(await user.getIdToken());
        window.location.assign(url);
      } catch (err) {
        clearPendingAsk();
        setBusy(false);
        setError(friendlyAgentError(err));
      }
      return;
    }
    void ask(example.text);
  }

  async function decide(approved: boolean) {
    if (!pending || busy || !user) return;
    setBusy(true);
    setError(null);
    try {
      const payload =
        pending.tool === "draft_email" && draftEdit
          ? {
              ...pending.payload,
              to: draftEdit.to,
              subject: draftEdit.subject,
              body: draftEdit.body,
            }
          : pending.payload;
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/v1/agent`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeZone,
          decision: {
            tool: pending.tool,
            approved,
            summary: pending.summary,
            payload,
            historyId: historyId ?? undefined,
          },
        }),
      });
      const result = (await res.json().catch(() => null)) as
        | (AgentTurnResponse & { error?: string })
        | null;
      if (!res.ok || !result?.reply) {
        if (noteLimit(result)) return;
        throw new Error(result?.error ?? "Could not finish that");
      }
      if (!approved && historyId && user) {
        queryClient.setQueryData(
          ["agent-history", user.uid],
          (current: { history: AgentHistoryItem[]; usage: AgentUsageStatus | null } | undefined) => {
            if (!current) return current;
            return {
              ...current,
              history: current.history.map((item) =>
                item.id === historyId ? { ...item, status: "cancelled" as const } : item,
              ),
            };
          },
        );
      }
      applyTurn(result, approved ? (lastRequest ?? pending.summary) : undefined);
      setPending(null);
      setPreview(null);
      setDraftEdit(null);
      setEditingDraft(false);
      if (!approved) setHistoryId(null);
      await queryClient.invalidateQueries({ queryKey: ["agent-history"] });
      await queryClient.invalidateQueries({ queryKey: ["agent-notes"] });
      await queryClient.invalidateQueries({ queryKey: ["agent-memories"] });
    } catch (err) {
      setError(friendlyAgentError(err));
    } finally {
      setBusy(false);
    }
  }

  async function pickDraftChoice(choice: {
    messageId: string;
    threadId: string;
  }) {
    if (!user || busy || preview?.kind !== "draft_choices") return;
    const choices = preview as AgentDraftChoicesPreview;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/v1/agent`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeZone,
          draftPick: {
            messageId: choice.messageId,
            threadId: choice.threadId,
            intent: choices.intent,
            query: choices.query,
          },
        }),
      });
      const result = (await res.json().catch(() => null)) as
        | (AgentTurnResponse & { error?: string })
        | null;
      if (!res.ok || !result?.reply) {
        if (noteLimit(result)) return;
        throw new Error(result?.error ?? "Could not open that thread");
      }
      applyTurn(result, lastRequest ?? `Draft to ${choices.query}`);
      await queryClient.invalidateQueries({ queryKey: ["agent-history"] });
    } catch (err) {
      setError(friendlyAgentError(err));
    } finally {
      setBusy(false);
    }
  }

  function startListening() {
    const rec = speechRecognition();
    if (!rec || busy) return;
    recognitionRef.current = rec;
    offerDeviceLocationOnce();
    unlockSpeech();
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

  async function deleteNote(id: string) {
    if (!user) return;
    setNoteError(null);
    const token = await user.getIdToken();
    const res = await fetch(`${API_URL}/v1/agent/notes/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setNoteError("Could not delete that note. Retry in a moment.");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["agent-notes"] });
  }

  async function clearHistory() {
    if (!user) return;
    const ok = window.confirm("Clear your Talk history? This cannot be undone.");
    if (!ok) return;
    const token = await user.getIdToken();
    const res = await fetch(`${API_URL}/v1/agent/history`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setError("Could not clear history.");
      return;
    }
    setReply(null);
    setReceipt(null);
    setLastRequest(null);
    setPending(null);
    setPreview(null);
    await queryClient.invalidateQueries({ queryKey: ["agent-history"] });
  }

  function retryLast() {
    if (!lastRequest) return;
    const example = EXAMPLES.find((item) => item.text === lastRequest);
    if (example) {
      void onExample(example);
      return;
    }
    void ask(lastRequest);
  }

  const memories = [...(memoriesQuery.data ?? [])].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  const notes = (notesQuery.data ?? [])
    .filter((note) => !isPlaceholderNote(note.text))
    .sort((a, b) => a.createdAt - b.createdAt);
  const history = [...(historyQuery.data?.history ?? [])].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  const newest = history[history.length - 1];
  const turnSaved = Boolean(
    (historyId && reply && history.some((item) => item.id === historyId)) ||
      (!historyId &&
        reply &&
        lastRequest &&
        newest?.reply === reply &&
        newest.request === lastRequest),
  );
  const showLive = !turnSaved && Boolean(busy || reply || pending || preview);
  const confirmOn = turnSaved ? historyId : showLive ? "live" : null;
  const receiptHref = safeHref(receipt?.href);
  const showExamples = history.length === 0 && !showLive;
  const reschedulePreview =
    preview?.kind === "reschedule" ? (preview as AgentReschedulePreview) : null;
  const draftChoicesPreview =
    preview?.kind === "draft_choices"
      ? (preview as AgentDraftChoicesPreview)
      : null;
  const draftPreview =
    draftEdit ??
    (preview?.kind === "draft_email" ? (preview as AgentDraftPreview) : null);
  const confirmCard = (
    <>
      {!busy && draftChoicesPreview ? (
        <div className="mt-3 rounded-2xl bg-surface px-3 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal">
            Pick a thread
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {draftChoicesPreview.choices.map((choice) => (
              <button
                key={choice.messageId}
                type="button"
                disabled={busy}
                onClick={() => void pickDraftChoice(choice)}
                className="rounded-2xl border border-black/10 bg-card px-4 py-3 text-left text-sm font-medium text-ink disabled:opacity-60"
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!busy && reschedulePreview && pending?.tool === "reschedule" ? (
        <div className="mt-3 rounded-2xl bg-surface px-3 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal">
            Reschedule preview
          </p>
          <p className="mt-2 text-sm text-ink">
            Move &apos;{reschedulePreview.title}&apos; from {reschedulePreview.oldWhen} to{" "}
            {reschedulePreview.newWhen}?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(true)}
              className="rounded-2xl bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(false)}
              className="rounded-2xl border border-black/10 bg-card px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {!busy && draftPreview && pending?.tool === "draft_email" ? (
        <div className="mt-3 rounded-2xl bg-surface px-3 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal">
            Draft preview
          </p>
          {editingDraft ? (
            <div className="mt-3 space-y-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-ink">To</span>
                <input
                  value={draftPreview.to}
                  onChange={(event) =>
                    setDraftEdit({ ...draftPreview, to: event.target.value })
                  }
                  className="w-full rounded-xl border border-black/10 bg-card px-3 py-2 text-sm"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-ink">Subject</span>
                <input
                  value={draftPreview.subject}
                  onChange={(event) =>
                    setDraftEdit({
                      ...draftPreview,
                      subject: event.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-black/10 bg-card px-3 py-2 text-sm"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-ink">Body</span>
                <textarea
                  value={draftPreview.body}
                  rows={5}
                  onChange={(event) =>
                    setDraftEdit({
                      ...draftPreview,
                      body: event.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-black/10 bg-card px-3 py-2 text-sm"
                />
              </label>
            </div>
          ) : (
            <div className="mt-2 space-y-1 text-sm text-ink">
              <p>
                <span className="text-muted">To:</span> {draftPreview.to}
              </p>
              <p>
                <span className="text-muted">Subject:</span> {draftPreview.subject}
              </p>
              <p className="whitespace-pre-wrap pt-2">{draftPreview.body}</p>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditingDraft((value) => !value)}
              className="rounded-2xl border border-black/10 bg-card px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {editingDraft ? "Done editing" : "Edit"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(true)}
              className="rounded-2xl bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Save to Gmail Drafts
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(false)}
              className="rounded-2xl border border-black/10 bg-card px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );

  const threadOpen = history.length > 0 || showLive || Boolean(error);
  const toolClass = (on: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-semibold ${on ? "bg-teal-soft text-teal" : "text-muted hover:bg-black/5"}`;

  const libraryPanel = library ? (
    <section className="max-h-[40vh] overflow-y-auto rounded-3xl border border-black/10 bg-card px-4 py-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
          {library === "memory" ? "Memory" : "Notes"}
        </p>
        <button
          type="button"
          onClick={() => setLibrary(null)}
          className="text-xs font-semibold text-muted"
        >
          Close
        </button>
      </div>
      {library === "memory" ? (
        memories.length > 0 ? (
          <ul className="flex flex-col gap-2">
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
        ) : (
          <p className="text-sm text-muted">Nothing saved yet.</p>
        )
      ) : notes.length > 0 || noteError ? (
        <>
          <ul className="flex flex-col gap-2">
            {notes.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-2xl bg-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-ink">{item.text}</p>
                  <time
                    dateTime={new Date(item.createdAt).toISOString()}
                    className="mt-1 block text-[11px] text-muted"
                  >
                    {formatNoteTime(item.createdAt)}
                  </time>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteNote(item.id)}
                  className="shrink-0 text-xs font-semibold text-coral"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
          {noteError ? <p className="mt-3 text-sm text-coral">{noteError}</p> : null}
        </>
      ) : (
        <p className="text-sm text-muted">Nothing saved yet.</p>
      )}
    </section>
  ) : null;

  const composer = (
    <form
      className="rounded-[28px] border border-black/10 bg-card px-2 pb-2 pt-1 shadow-[0_8px_30px_rgba(17,24,39,0.06)]"
      onSubmit={(event) => {
        event.preventDefault();
        unlockSpeech();
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
        placeholder="Say or type a request"
        className="w-full bg-transparent px-3 py-3 text-base outline-none placeholder:text-muted"
      />
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          aria-pressed={library === "memory"}
          onClick={() => {
            setMenuOpen(false);
            setLibrary(library === "memory" ? null : "memory");
          }}
          className={toolClass(library === "memory")}
        >
          Memory{memories.length ? ` ${memories.length}` : ""}
        </button>
        <button
          type="button"
          aria-pressed={library === "notes"}
          onClick={() => {
            setMenuOpen(false);
            setLibrary(library === "notes" ? null : "notes");
          }}
          className={toolClass(library === "notes")}
        >
          Notes{notes.length ? ` ${notes.length}` : ""}
        </button>
        <button
          type="button"
          aria-expanded={menuOpen}
          onClick={() => {
            setLibrary(null);
            setMenuOpen((open) => !open);
          }}
          className={toolClass(menuOpen)}
        >
          More
        </button>
        {usage?.plan !== "pro" ? (
          <Link href="/pricing" className="rounded-full px-3 py-1.5 text-xs font-semibold text-teal">
            Upgrade
          </Link>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {canListen ? (
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              disabled={busy}
              aria-label={listening ? "Stop microphone" : "Microphone"}
              className="flex h-9 items-center justify-center rounded-full px-3 text-xs font-semibold text-teal hover:bg-teal-soft disabled:opacity-40"
            >
              {listening ? "•" : "Mic"}
            </button>
          ) : null}
          <button
            type="submit"
            disabled={busy || !text.trim()}
            aria-label={busy ? "Asking" : "Ask"}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-teal text-base font-semibold text-white disabled:opacity-40"
          >
            {busy ? "…" : "↑"}
          </button>
        </div>
      </div>
    </form>
  );

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col overflow-hidden pt-16">
      <header className="flex items-center justify-between px-4 py-2">
        <h1 className="text-sm font-semibold text-ink">Talk</h1>
        {usage?.plan === "pro" ? (
          <p className="rounded-full bg-teal-soft px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-teal">
            Pro
          </p>
        ) : usage && usage.remaining !== null ? (
          <p className="text-xs text-muted">{usage.remaining} left today</p>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {threadOpen ? (
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end gap-6 px-4 py-6">
            {history.map((item) => (
              <div key={item.id} className="flex flex-col gap-3">
                <UserBubble text={item.request} />
                <NearbyBubble time={formatNoteTime(item.createdAt)}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="whitespace-pre-wrap break-words">{item.reply}</p>
                    {item.status === "cancelled" ? (
                      <span className="shrink-0 rounded-full bg-coral-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-coral">
                        Cancelled
                      </span>
                    ) : null}
                  </div>
                  {item.receipt ? <ReceiptLine receipt={item.receipt} /> : null}
                  {item.id === confirmOn ? confirmCard : null}
                </NearbyBubble>
              </div>
            ))}
            {showLive ? (
              <div className="flex flex-col gap-3" aria-live="polite" aria-busy={busy}>
                {lastRequest ? <UserBubble text={lastRequest} /> : null}
                <NearbyBubble>
                  {busy ? (
                    <div>
                      <div className="h-4 w-40 animate-pulse rounded bg-black/10" />
                      <p className="mt-2 text-sm text-muted">Working on that…</p>
                    </div>
                  ) : (
                    <>
                      {reply ? <p className="whitespace-pre-wrap break-words">{reply}</p> : null}
                      {receipt ? (
                        <p className="mt-2 text-sm text-ink">
                          <span className="font-semibold text-teal">Done:</span> {receipt.action}
                          {receiptHref ? (
                            <>
                              {" "}
                              <a
                                href={receiptHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-teal underline"
                              >
                                {receipt.linkLabel ?? "Open"}
                              </a>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      {confirmOn === "live" ? confirmCard : null}
                    </>
                  )}
                </NearbyBubble>
              </div>
            ) : null}
            {error ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-coral">{error}</p>
                {lastRequest ? (
                  <button
                    type="button"
                    onClick={() => retryLast()}
                    className="rounded-full bg-coral-soft px-3 py-1.5 text-xs font-semibold text-coral"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        ) : (
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-4 pb-10">
            <h2 className="text-center text-3xl font-medium tracking-tight text-ink sm:text-4xl">
              Say or type a request.
            </h2>
            <div className="relative mt-6 w-full">
              {libraryPanel}
              {menuOpen ? (
                <div className="mb-2 rounded-3xl border border-black/10 bg-card px-4 py-3 text-sm text-ink shadow-lg">
                  <PendantAccountNote pendantId={profile?.pendantId} className="text-sm text-ink" />
                  <div className="mt-3">
                    <VoiceMemoPanel />
                  </div>
                </div>
              ) : null}
              {composer}
            </div>
            {showExamples ? (
              <div className="mt-4 grid w-full gap-3 sm:grid-cols-3">
                {EXAMPLES.map((example) => (
                  <button
                    key={example.id}
                    type="button"
                    disabled={busy || googleQuery.isLoading}
                    onClick={() => void onExample(example)}
                    className="rounded-2xl border border-black/10 bg-card px-4 py-3 text-left text-sm leading-snug text-ink transition hover:border-teal/40 disabled:opacity-60"
                  >
                    {example.text}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </main>

      {threadOpen ? (
        <footer className="relative px-4 pb-3">
          <div className="mx-auto w-full max-w-3xl">
            {library ? <div className="absolute inset-x-4 bottom-full mb-2">{libraryPanel}</div> : null}
            {menuOpen ? (
              <div className="absolute inset-x-4 bottom-full z-10 mb-2 rounded-3xl border border-black/10 bg-card px-4 py-3 shadow-lg">
                <PendantAccountNote pendantId={profile?.pendantId} className="text-sm text-ink" />
                <div className="mt-3">
                  <VoiceMemoPanel />
                </div>
                {history.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => void clearHistory()}
                    className="mt-3 text-xs font-semibold text-coral"
                  >
                    Clear history
                  </button>
                ) : null}
              </div>
            ) : null}
            {locationNote ? <p className="mb-2 text-sm text-muted">{locationNote}</p> : null}
            {composer}
            <p className="mt-2 text-center text-[11px] text-muted">{CONNECTOR_PRIVACY_LINE}</p>
          </div>
        </footer>
      ) : (
        <p className="pb-4 text-center text-[11px] text-muted">{CONNECTOR_PRIVACY_LINE}</p>
      )}

      <TabBar active="activity" />
      {limitHit ? (
        <UpgradeSheet feature={limitHit.feature} onClose={() => setLimitHit(null)} />
      ) : null}
    </div>
  );

}
