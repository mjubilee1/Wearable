"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  DEMO_TRY_LIMIT,
  turnNeedsDeviceLocation,
  type AgentActionReceipt,
} from "@nearby/shared";
import { locationForTurn, offerDeviceLocationOnce } from "@/lib/device-location";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const STORAGE_KEY = "nearby-home-demo-tries";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: {
    results: ArrayLike<ArrayLike<{ transcript: string }>>;
  }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function createRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Recognition =
    speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;
  return recognition;
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

function unlockSpeech() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.resume();
  const warmup = new SpeechSynthesisUtterance(" ");
  warmup.volume = 0;
  window.speechSynthesis.speak(warmup);
}

export function HomepageLiveDemo() {
  const [tries, setTries] = useState(0);
  const [text, setText] = useState("");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [receipt, setReceipt] = useState<AgentActionReceipt | null>(null);
  const [listening, setListening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showText, setShowText] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY) ?? 0);
    setTries(Number.isFinite(saved) ? Math.min(DEMO_TRY_LIMIT, Math.max(0, saved)) : 0);
    setShowText(!createRecognition());
    return () => recognitionRef.current?.stop();
  }, []);

  const exhausted = tries >= DEMO_TRY_LIMIT;

  async function runTask(task: string) {
    const clean = task.trim();
    if (!clean || exhausted || loading) return;
    const locationPromise = locationForTurn(turnNeedsDeviceLocation(clean));
    setLoading(true);
    setError("");
    setReply("");
    setReceipt(null);
    setHeard(clean);
    try {
      const location = await locationPromise;
      const response = await fetch(`${API_URL}/v1/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          demo: true,
          text: clean,
          ...(location ? { location } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        reply?: string;
        receipt?: AgentActionReceipt | null;
        error?: string;
        code?: string;
      };
      if (response.status === 429 || body.code === "demo_limit_reached") {
        window.localStorage.setItem(STORAGE_KEY, String(DEMO_TRY_LIMIT));
        setTries(DEMO_TRY_LIMIT);
        return;
      }
      if (!response.ok || !body.reply) {
        throw new Error(body.error ?? "The demo couldn't run that task.");
      }
      const nextTries = Math.min(DEMO_TRY_LIMIT, tries + 1);
      window.localStorage.setItem(STORAGE_KEY, String(nextTries));
      setTries(nextTries);
      setReply(body.reply);
      setReceipt(body.receipt ?? null);
      setText("");
      speak(body.reply);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The demo couldn't run that task.");
      setShowText(true);
    } finally {
      setLoading(false);
    }
  }

  function startListening() {
    if (exhausted || loading) return;
    offerDeviceLocationOnce();
    unlockSpeech();
    setError("");
    const recognition = createRecognition();
    if (!recognition) {
      setShowText(true);
      setError("Microphone speech recognition isn't available here. Type a task instead.");
      return;
    }
    recognitionRef.current = recognition;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setListening(false);
      if (transcript) void runTask(transcript);
    };
    recognition.onerror = () => {
      setListening(false);
      setShowText(true);
      setError("Microphone access was blocked. Type a task instead.");
    };
    recognition.onend = () => setListening(false);
    try {
      // Starting from the tap keeps iOS Safari's permission and audio gestures valid.
      recognition.start();
      setListening(true);
    } catch {
      setShowText(true);
      setError("The microphone couldn't start. Type a task instead.");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    unlockSpeech();
    void runTask(text);
  }

  return (
    <section className="px-5 pb-16" aria-labelledby="live-demo-title">
      <div className="mx-auto grid max-w-5xl gap-8 border border-ink/20 bg-white px-5 py-6 sm:grid-cols-[auto_1fr] sm:items-center sm:px-8">
        {!exhausted ? (
          <button
            type="button"
            onClick={startListening}
            disabled={loading || listening}
            aria-label={listening ? "Listening" : "Start voice demo"}
            className="flex size-16 items-center justify-center bg-ink text-white disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-7 fill-none stroke-current stroke-2">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6" />
            </svg>
          </button>
        ) : (
          <div className="size-16 bg-teal-soft" aria-hidden />
        )}
        <div>
          <h2 id="live-demo-title" className="font-display text-3xl font-medium leading-none">
            Try it. Say a task.
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted">
            No signup. This sandbox uses a fake calendar and inbox.
          </p>
          {!exhausted ? (
            <>
              <p className="mt-3 text-sm text-ink">
                {listening ? "Listening…" : loading ? "Doing it…" : `${DEMO_TRY_LIMIT - tries} demo ${DEMO_TRY_LIMIT - tries === 1 ? "try" : "tries"} left`}
              </p>
              <button
                type="button"
                onClick={() => setShowText(true)}
                className="mt-2 text-sm text-ink underline decoration-teal decoration-2 underline-offset-4"
              >
                Type instead
              </button>
              {showText && (
                <form onSubmit={submit} className="mt-4 flex max-w-md gap-2">
                  <label htmlFor="demo-task" className="sr-only">Task</label>
                  <input
                    id="demo-task"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="e.g. Check my unread inbox"
                    className="min-w-0 flex-1 border border-ink/20 bg-paper px-3 py-2.5 text-sm outline-none focus:border-ink"
                  />
                  <button
                    type="submit"
                    disabled={!text.trim() || loading}
                    className="bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Run
                  </button>
                </form>
              )}
            </>
          ) : (
            <div className="mt-4">
              <p className="text-ink">Connect your Google to make it real</p>
              <Link href="/signup" className="mt-3 inline-flex bg-ink px-4 py-2.5 text-sm font-semibold text-white">
                Sign up
              </Link>
            </div>
          )}
          {error && <p className="mt-4 text-sm text-coral" role="alert">{error}</p>}
          {(reply || receipt) && (
            <div className="mt-5 border-t border-ink/10 pt-4" aria-live="polite">
              {heard && <p className="font-display text-lg italic text-ink">“{heard}”</p>}
              {reply && <p className="mt-2 text-sm text-ink">{reply}</p>}
              {receipt && (
                <p className="mt-3 text-sm text-ink">
                  <span className="font-semibold">Done.</span> {receipt.action}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
