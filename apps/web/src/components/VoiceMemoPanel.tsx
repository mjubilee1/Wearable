"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  VOICE_MEMO_MAX_SECONDS,
  type VoiceMemo,
  type VoiceMemoAction,
  type VoiceMemoListResponse,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const NOTICE_KEY = "nearby.voice-memo-recording-notice.v1";

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function timeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
}

function RecordingNotice({
  onContinue,
  onCancel,
}: {
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recording-notice-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-3xl bg-card p-6 shadow-xl">
        <h2 id="recording-notice-title" className="text-lg font-bold text-ink">
          Before you record
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted">
          Only record others with their permission. You&apos;re responsible for following local recording laws.
        </p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onContinue}
            className="rounded-2xl bg-teal px-4 py-2 text-sm font-semibold text-white"
          >
            Continue
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-black/10 px-4 py-2 text-sm font-semibold text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function actionTitle(action: VoiceMemoAction): string {
  if (action.type === "reminder") return "Reminder";
  if (action.type === "calendar_event") return "Calendar event";
  return "Email draft";
}

export function VoiceMemoPanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const elapsedRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftDetails, setDraftDetails] = useState<Record<string, string>>({});
  const [editedDetails, setEditedDetails] = useState<
    Record<string, Record<string, string>>
  >({});

  const memosQuery = useQuery({
    queryKey: ["voice-memos", user?.uid],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) throw new Error("Sign in first");
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/v1/voice-memos`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Could not load voice memos");
      return (await res.json()) as VoiceMemoListResponse;
    },
  });

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setElapsed((value) => {
        const next = value + 1;
        elapsedRef.current = next;
        if (next >= VOICE_MEMO_MAX_SECONDS) recorderRef.current?.stop();
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(
    () => () => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  async function uploadAudio(blob: Blob, durationSeconds: number) {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const extension = blob.type.includes("mp4") ? "m4a" : "webm";
      const form = new FormData();
      form.set("audio", blob, `memo.${extension}`);
      form.set("durationSeconds", String(Math.max(1, durationSeconds)));
      form.set("timeZone", timeZone());
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/v1/voice-memos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = (await res.json().catch(() => null)) as
        | { memo?: VoiceMemo; error?: string }
        | null;
      if (!res.ok) throw new Error(body?.error ?? "Could not process that memo");
      await queryClient.invalidateQueries({ queryKey: ["voice-memos"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not process that memo");
    } finally {
      chunksRef.current = [];
      setBusy(false);
    }
  }

  async function beginRecording() {
    if (memosQuery.data?.usage.plan !== "pro") return;
    if (!window.localStorage.getItem(`${NOTICE_KEY}:${user?.uid ?? "unknown"}`)) {
      setNoticeOpen(true);
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferred = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "";
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      elapsedRef.current = 0;
      setElapsed(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => setError("Recording stopped unexpectedly. Please retry.");
      recorder.onstop = () => {
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size) void uploadAudio(blob, elapsedRef.current);
      };
      recorder.start(1000);
      setRecording(true);
    } catch {
      setError("Microphone access is required to record a voice memo.");
    }
  }

  function acceptNotice() {
    window.localStorage.setItem(
      `${NOTICE_KEY}:${user?.uid ?? "unknown"}`,
      "acknowledged",
    );
    setNoticeOpen(false);
    void beginRecording();
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function decide(
    memo: VoiceMemo,
    action: VoiceMemoAction,
    decision: "confirm" | "skip",
  ) {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `${API_URL}/v1/voice-memos/${memo.id}/actions/${action.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            decision,
            details:
              editing === action.id
                ? draftDetails
                : (editedDetails[action.id] ?? action.details),
            timeZone: timeZone(),
          }),
        },
      );
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Could not update that action");
      setEditing(null);
      setEditedDetails((current) => {
        const next = { ...current };
        delete next[action.id];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["voice-memos"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update that action");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMemo(id: string) {
    if (!user || !window.confirm("Delete this voice memo and its recap?")) return;
    const token = await user.getIdToken();
    const res = await fetch(`${API_URL}/v1/voice-memos/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setError("Could not delete that memo.");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["voice-memos"] });
  }

  const data = memosQuery.data;
  const isPro = data?.usage.plan === "pro";
  const atLimit = data?.usage.remainingMinutes === 0;
  const memos = data?.memos ?? [];
  const expanded = recording || memos.length > 0;

  const recordControl =
    !memosQuery.isLoading && !isPro ? (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded-2xl border border-teal/30 bg-teal-soft px-5 py-3 text-sm font-semibold text-teal"
          onClick={() => setError("Voice Memo Recap is a Pro feature.")}
        >
          Record
        </button>
        <Link href="/pricing" className="text-sm font-semibold text-teal underline">
          Upgrade to Pro
        </Link>
      </div>
    ) : (
      <button
        type="button"
        disabled={busy || Boolean(atLimit) || memosQuery.isLoading}
        onClick={recording ? stopRecording : () => void beginRecording()}
        className={`rounded-2xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-60 ${
          recording ? "bg-coral" : "bg-teal"
        }`}
      >
        {recording ? `Stop · ${clock(elapsed)}` : busy ? "Creating recap…" : "Record"}
      </button>
    );

  if (!expanded) {
    return (
      <>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">Voice memo</p>
          {!memosQuery.isLoading && !isPro ? (
            <Link href="/pricing" className="text-sm font-semibold text-teal">
              Upgrade
            </Link>
          ) : (
            <button
              type="button"
              disabled={busy || Boolean(atLimit) || memosQuery.isLoading}
              onClick={() => void beginRecording()}
              className="text-sm font-semibold text-teal disabled:opacity-60"
            >
              {busy ? "Creating recap…" : "Record"}
            </button>
          )}
        </div>
        {error ? <p className="text-sm text-coral">{error}</p> : null}
        {noticeOpen ? (
          <RecordingNotice
            onContinue={acceptNotice}
            onCancel={() => setNoticeOpen(false)}
          />
        ) : null}
      </>
    );
  }

  return (
    <section className="rounded-3xl border border-black/5 bg-card px-5 py-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
            Voice memo
          </p>
          <p className="mt-2 text-sm text-muted">
            Record up to 5 minutes. Nearby creates a recap and follow-ups for you to confirm.
          </p>
        </div>
        {isPro && data ? (
          <span className="rounded-full bg-teal-soft px-3 py-1 text-xs font-semibold text-teal">
            {data.usage.remainingMinutes} min left
          </span>
        ) : null}
      </div>

      <div className="mt-4">{recordControl}</div>
      {atLimit ? (
        <p className="mt-3 text-sm text-muted">
          You&apos;ve used this month&apos;s 300 voice memo minutes. Your minutes reset next month.
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-coral">{error}</p> : null}

      {memos.length > 0 ? (
      <div className="mt-5 space-y-4">
        {memos.map((memo) => (
          <article key={memo.id} className="rounded-2xl bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="whitespace-pre-line text-sm font-medium leading-6 text-ink">
                  {memo.recap}
                </p>
                <details className="mt-2 text-xs text-muted">
                  <summary className="cursor-pointer font-semibold">Transcript</summary>
                  <p className="mt-2 whitespace-pre-wrap">{memo.transcript}</p>
                </details>
              </div>
              <button
                type="button"
                onClick={() => void deleteMemo(memo.id)}
                className="shrink-0 text-xs font-semibold text-coral"
              >
                Delete
              </button>
            </div>
            {memo.actions.length ? (
              <div className="mt-4 space-y-3">
                {memo.actions.map((action) => {
                  const values =
                    editing === action.id
                      ? draftDetails
                      : (editedDetails[action.id] ?? action.details);
                  return (
                    <div key={action.id} className="rounded-2xl bg-card p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold uppercase tracking-wide text-teal">
                          {actionTitle(action)}
                        </p>
                        {action.status !== "proposed" ? (
                          <span className="text-xs font-semibold capitalize text-muted">
                            {action.status}
                          </span>
                        ) : null}
                      </div>
                      {editing === action.id ? (
                        <div className="mt-3 space-y-2">
                          {Object.entries(values).map(([key, value]) => (
                            <label key={key} className="block">
                              <span className="text-xs font-semibold capitalize text-muted">
                                {key.replaceAll("_", " ")}
                              </span>
                              <textarea
                                rows={key === "body" || key === "description" ? 4 : 1}
                                value={value}
                                onChange={(event) =>
                                  setDraftDetails((current) => ({
                                    ...current,
                                    [key]: event.target.value,
                                  }))
                                }
                                className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm text-ink"
                              />
                            </label>
                          ))}
                        </div>
                      ) : (
                        <dl className="mt-2 space-y-1 text-sm text-ink">
                          {Object.entries(action.details).map(([key, value]) => (
                            <div key={key}>
                              <dt className="inline font-semibold capitalize">
                                {key.replaceAll("_", " ")}:{" "}
                              </dt>
                              <dd className="inline whitespace-pre-wrap">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {action.receipt ? (
                        <p className="mt-2 text-xs font-semibold text-teal">
                          Done: {action.receipt.action}
                        </p>
                      ) : null}
                      {action.status === "proposed" ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(memo, action, "confirm")}
                            className="rounded-xl bg-teal px-3 py-2 text-xs font-semibold text-white"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (editing === action.id) {
                                setEditedDetails((current) => ({
                                  ...current,
                                  [action.id]: draftDetails,
                                }));
                                setEditing(null);
                              } else {
                                setDraftDetails(
                                  editedDetails[action.id] ?? action.details,
                                );
                                setEditing(action.id);
                              }
                            }}
                            className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold text-ink"
                          >
                            {editing === action.id ? "Done editing" : "Edit"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(memo, action, "skip")}
                            className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold text-muted"
                          >
                            Skip
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted">No follow-up actions suggested.</p>
            )}
          </article>
        ))}
      </div>
      ) : null}

      {noticeOpen ? (
        <RecordingNotice
          onContinue={acceptNotice}
          onCancel={() => setNoticeOpen(false)}
        />
      ) : null}
    </section>
  );
}
