"use client";

import { useEffect, useRef, useState } from "react";
import {
  loudnessToStatus,
  statusLabel,
  type WorkSpot,
  type WorkSpotStatus,
} from "@nearby/shared";
import { saveLocalSpotReading } from "@/lib/local-spot-readings";
import {
  measureRelativeLoudness,
  requestMicrophonePermission,
} from "@/lib/read-spot-loudness";
import { submitWorkSpotReading } from "@/lib/work-spots-api";

type Step = "intro" | "measuring" | "tags" | "done" | "error";

const TAG_OPTIONS = ["Quiet", "Normal", "Busy", "Outlets", "Good for calls"];

export function ReadSpotFlow({
  spot,
  onClose,
  onComplete,
}: {
  spot: WorkSpot;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<Step>("intro");
  const [message, setMessage] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(10);
  const [loudness, setLoudness] = useState(0);
  const [status, setStatus] = useState<WorkSpotStatus>("normal");
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (step !== "measuring" || started.current) return;
    started.current = true;
    const timeout = window.setTimeout(() => {
      setStep("error");
      setMessage("This took too long. Try again.");
    }, 15_000);
    void (async () => {
      try {
        const permission = await requestMicrophonePermission();
        if (permission === "unsupported") {
          setStep("error");
          setMessage("Microphone not supported on this browser.");
          return;
        }
        if (permission === "denied") {
          setStep("error");
          setMessage("Allow microphone access to read this spot.");
          return;
        }
        const sample = await measureRelativeLoudness(10, (remaining, level) => {
          setSecondsLeft(remaining);
          setLoudness(level);
        });
        setLoudness(sample.loudness);
        const nextStatus = loudnessToStatus(sample.loudness);
        setStatus(nextStatus);
        setTags(
          [
            statusLabel(nextStatus),
            ...(nextStatus === "quiet" ? ["Outlets"] : []),
          ].slice(0, 3),
        );
        setStep("tags");
      } catch (caught) {
        setStep("error");
        setMessage(
          caught instanceof Error ? caught.message : "Could not measure sound.",
        );
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => window.clearTimeout(timeout);
  }, [step]);

  async function submit() {
    setSubmitting(true);
    setMessage(null);
    try {
      const normalizedTags = tags.map((tag) => tag.trim()).filter(Boolean);
      saveLocalSpotReading(spot.id, {
        loudness,
        status,
        tags: normalizedTags,
      });
      await submitWorkSpotReading(spot.id, {
        loudness,
        status,
        tags: normalizedTags,
      }).catch(() => undefined);
      setStep("done");
      onComplete();
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not save reading.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 border-t border-ink/10 pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-ink">Read this spot</h3>
        <button type="button" className="text-sm text-muted" onClick={onClose}>
          Close
        </button>
      </div>

      {step === "intro" ? (
        <>
          <p className="text-sm text-muted">
            Measuring loudness only. No audio is saved.
          </p>
          <button
            type="button"
            className="bg-ink px-4 py-2.5 text-sm font-semibold text-white"
            onClick={() => setStep("measuring")}
          >
            Start 10-second listen
          </button>
        </>
      ) : null}

      {step === "measuring" ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            Measuring loudness only. No audio is saved.
          </p>
          <p className="text-2xl font-semibold text-ink">{secondsLeft}s</p>
          <div className="h-2 w-full bg-surface">
            <div
              className="h-full bg-teal transition-all"
              style={{ width: `${Math.min(100, loudness)}%` }}
            />
          </div>
        </div>
      ) : null}

      {step === "tags" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Relative loudness {loudness}/100 → {statusLabel(status)}
          </p>
          <div className="flex flex-wrap gap-2">
            {TAG_OPTIONS.map((tag) => {
              const active = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    setTags((current) =>
                      active
                        ? current.filter((row) => row !== tag)
                        : [...current, tag],
                    )
                  }
                  className={
                    active
                      ? "border border-ink bg-ink px-3 py-1.5 text-xs font-semibold text-white"
                      : "border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink"
                  }
                >
                  {tag}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Submit"}
          </button>
        </div>
      ) : null}

      {step === "done" ? (
        <p className="text-sm text-ink">
          Thanks — {spot.name} now shows {statusLabel(status)}.
        </p>
      ) : null}

      {step === "error" && message ? (
        <p className="text-sm text-coral">{message}</p>
      ) : null}
      {message && step !== "error" ? (
        <p className="text-sm text-muted">{message}</p>
      ) : null}
    </div>
  );
}
