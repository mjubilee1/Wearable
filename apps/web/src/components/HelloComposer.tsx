"use client";

import { useEffect, useState } from "react";
import { INTRO_MESSAGE_MAX } from "@nearby/shared";

type HelloComposerProps = {
  name: string;
  initialMessage?: string;
  sending?: boolean;
  error?: string | null;
  onSend: (message: string) => void;
  onCancel: () => void;
};

export function HelloComposer({
  name,
  initialMessage = "",
  sending,
  error,
  onSend,
  onCancel,
}: HelloComposerProps) {
  const [message, setMessage] = useState(initialMessage);

  useEffect(() => {
    setMessage(initialMessage);
  }, [initialMessage]);

  const remaining = INTRO_MESSAGE_MAX - message.length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-labelledby="hello-composer-title"
        className="w-full max-w-md rounded-3xl bg-card p-5 shadow-xl"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
          Warm intro
        </p>
        <h2
          id="hello-composer-title"
          className="mt-1 text-xl font-bold tracking-tight text-ink"
        >
          Say hello to {name}
        </h2>
        <p className="mt-2 text-sm text-muted">
          One short message. They’ll see your profile and choose whether to
          connect — no chat until they accept.
        </p>

        <label className="mt-4 block">
          <span className="sr-only">Intro message</span>
          <textarea
            value={message}
            onChange={(e) =>
              setMessage(e.target.value.slice(0, INTRO_MESSAGE_MAX))
            }
            rows={4}
            placeholder="Hey — we seem to overlap on a few vibes. Want to connect?"
            className="w-full resize-none rounded-2xl border border-black/10 bg-surface px-3.5 py-3 text-sm text-ink outline-none ring-teal/30 placeholder:text-muted focus:ring-2"
          />
        </label>

        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
          <span>No links or handles — keep it human.</span>
          <span className={remaining < 20 ? "text-coral" : ""}>
            {remaining}
          </span>
        </div>

        {error ? <p className="mt-2 text-sm text-coral">{error}</p> : null}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="flex-1 rounded-2xl border border-black/10 px-3 py-2.5 text-sm font-semibold text-muted transition hover:bg-surface disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSend(message)}
            disabled={sending || !message.trim()}
            className="flex-1 rounded-2xl bg-teal px-3 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send hello"}
          </button>
        </div>
      </div>
    </div>
  );
}
