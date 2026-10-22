"use client";

import { useEffect, useRef, useState } from "react";
import type {
  GeoPoint,
  NearbySpatialPlace,
  ObservationSubmission,
  SpatialInsight,
  SpatialQueryResult,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { browserLocationService } from "@/lib/device-location";
import { compressImageFile } from "@/lib/image-observation";
import {
  askSpatialQuery,
  getObservationSubmission,
  getPlaceInsights,
  sendInsightFeedback,
  submitImageObservation,
} from "@/lib/spatial-api";

export function ScanSurroundingsSection({
  location,
  places,
}: {
  location: GeoPoint;
  places: NearbySpatialPlace[];
}) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submission, setSubmission] = useState<ObservationSubmission | null>(
    null,
  );
  const [insights, setInsights] = useState<SpatialInsight[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<SpatialQueryResult | null>(null);

  useEffect(() => {
    if (!selectedPlaceId && places[0]) setSelectedPlaceId(places[0].id);
  }, [places, selectedPlaceId]);

  useEffect(() => {
    if (!user || !selectedPlaceId) return;
    void user.getIdToken().then((token) =>
      getPlaceInsights(token, selectedPlaceId).then((response) =>
        setInsights(response.insights),
      ),
    );
  }, [selectedPlaceId, user, submission?.state]);

  useEffect(() => {
    if (!user || !submission) return;
    if (
      submission.state === "published" ||
      submission.state === "review_required" ||
      submission.state === "failed"
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void user.getIdToken().then(async (token) => {
        const next = await getObservationSubmission(token, submission.id);
        setSubmission(next);
        if (next.state === "published" && next.placeMatch?.placeId) {
          setSelectedPlaceId(next.placeMatch.placeId);
        }
      });
    }, 800);
    return () => window.clearInterval(timer);
  }, [submission, user]);

  async function onScan(file: File | null) {
    if (!user || !file) return;
    setBusy(true);
    setMessage(null);
    try {
      const compressed = await compressImageFile(file);
      let spatialLocation;
      try {
        spatialLocation = await browserLocationService.getCurrentLocation({
          requestPermission: true,
        });
      } catch {
        spatialLocation = {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracyMeters: location.accuracyMeters ?? null,
          timestamp: new Date().toISOString(),
        };
      }
      if (!selectedPlaceId) {
        throw new Error("Pick a place first.");
      }
      const token = await user.getIdToken();
      const next = await submitImageObservation(token, {
        image: compressed,
        location: spatialLocation,
        candidatePlaceId: selectedPlaceId,
      });
      setSubmission(next);
      setMessage("Photo checked. The image is not kept.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Scan failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function runQuery() {
    if (!user || question.trim().length < 3) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      setAnswer(await askSpatialQuery(token, question, location));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Ask failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-ink/10 pt-8">
      <h2 className="text-lg font-semibold text-ink">Scan</h2>
      <p className="mt-1 text-sm text-muted">
        Optional photo of a place. Image is not stored.
      </p>

      <label className="mt-4 block text-sm text-muted">
        Place
        <select
          value={selectedPlaceId}
          onChange={(event) => setSelectedPlaceId(event.target.value)}
          className="mt-1 w-full border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
        >
          <option value="">Select</option>
          {places.map((place) => (
            <option key={place.id} value={place.id}>
              {place.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        disabled={busy || !selectedPlaceId}
        onClick={() => inputRef.current?.click()}
        className="mt-3 bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Working…" : "Take photo"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => void onScan(event.target.files?.[0] ?? null)}
      />

      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}

      {insights.length ? (
        <ul className="mt-5 space-y-3">
          {insights.map((insight) => (
            <li key={insight.id}>
              <p className="text-sm text-ink">{insight.text}</p>
              <div className="mt-1 flex gap-3 text-xs text-muted">
                <button
                  type="button"
                  onClick={() =>
                    void user
                      ?.getIdToken()
                      .then((token) =>
                        sendInsightFeedback(token, insight.id, true),
                      )
                  }
                >
                  Right
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void user
                      ?.getIdToken()
                      .then((token) =>
                        sendInsightFeedback(token, insight.id, false),
                      )
                  }
                >
                  Wrong
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6 border-t border-ink/10 pt-5">
        <p className="text-sm font-medium text-ink">Ask</p>
        <div className="mt-2 flex gap-2">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="e.g. outlets nearby?"
            className="min-w-0 flex-1 border border-ink/15 px-3 py-2 text-sm text-ink"
            aria-label="Ask about nearby"
          />
          <button
            type="button"
            disabled={busy || question.trim().length < 3}
            onClick={() => void runQuery()}
            className="border border-ink/15 px-3 py-2 text-sm text-ink disabled:opacity-50"
          >
            Ask
          </button>
        </div>
        {answer ? (
          <p className="mt-3 text-sm text-ink">{answer.answer}</p>
        ) : null}
      </div>
    </section>
  );
}
