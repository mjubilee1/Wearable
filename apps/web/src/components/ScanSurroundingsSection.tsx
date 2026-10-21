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
  const [selectedPlaceId, setSelectedPlaceId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submission, setSubmission] = useState<ObservationSubmission | null>(
    null,
  );
  const [insights, setInsights] = useState<SpatialInsight[]>([]);
  const [question, setQuestion] = useState("Which cafés nearby have outlets?");
  const [queryResult, setQueryResult] = useState<SpatialQueryResult | null>(
    null,
  );

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
    setError(null);
    setNotice(null);
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
        throw new Error("Select the place this photo shows before scanning.");
      }
      const token = await user.getIdToken();
      const next = await submitImageObservation(token, {
        image: compressed,
        location: spatialLocation,
        candidatePlaceId: selectedPlaceId,
      });
      setSubmission(next);
      setNotice(
        "Photo accepted. Nearby Hello keeps only structured attributes—not the image.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not scan surroundings.",
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function runQuery() {
    if (!user || question.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      setQueryResult(await askSpatialQuery(token, question, location));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not answer that question.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-black/5 bg-card p-5 shadow-sm">
      <p className="text-lg font-bold text-ink">Scan surroundings</p>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Take one photo when you choose to. Nearby Hello looks for supported
        visible details like outlets or empty seats, links them only after you
        pick the place, and never keeps the photo.
      </p>

      <label className="mt-4 block text-xs font-bold uppercase tracking-[0.12em] text-muted">
        Place shown in the photo
        <select
          value={selectedPlaceId}
          onChange={(event) => setSelectedPlaceId(event.target.value)}
          className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-medium text-ink"
        >
          <option value="">Select a nearby place</option>
          {places.map((place) => (
            <option key={place.id} value={place.id}>
              {place.name} · {place.distanceMeters} m
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !selectedPlaceId}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl bg-teal px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "Scan surroundings"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => void onScan(event.target.files?.[0] ?? null)}
        />
      </div>

      {notice ? (
        <p className="mt-3 rounded-xl bg-teal-soft px-3 py-2 text-sm text-teal">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-xl bg-coral-soft px-3 py-2 text-sm text-coral">
          {error}
        </p>
      ) : null}
      {submission ? (
        <p className="mt-3 text-xs text-muted">
          Status: {submission.state.replaceAll("_", " ")}
          {submission.placeMatch
            ? ` · match ${Math.round(submission.placeMatch.confidence * 100)}%`
            : ""}
          {submission.cost
            ? ` · est. $${submission.cost.estimatedUsd.toFixed(4)} · ${submission.cost.latencyMs} ms`
            : ""}
        </p>
      ) : null}

      <div className="mt-5 space-y-3">
        {insights.length ? (
          insights.map((insight) => (
            <article
              key={insight.id}
              className="rounded-2xl border border-black/10 p-4"
            >
              <p className="text-sm font-bold text-ink">{insight.text}</p>
              <p className="mt-2 text-xs text-muted">
                {insight.sourceLabel} · {insight.verificationStatus.replaceAll("_", " ")} ·{" "}
                {Math.round(insight.confidence * 100)}% confidence · observed{" "}
                {new Date(insight.observedAt).toLocaleString()}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="text-xs font-bold text-teal"
                  onClick={() =>
                    void user
                      ?.getIdToken()
                      .then((token) =>
                        sendInsightFeedback(token, insight.id, true),
                      )
                  }
                >
                  Looks right
                </button>
                <button
                  type="button"
                  className="text-xs font-bold text-muted"
                  onClick={() =>
                    void user
                      ?.getIdToken()
                      .then((token) =>
                        sendInsightFeedback(token, insight.id, false),
                      )
                  }
                >
                  Not right
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className="rounded-2xl border border-dashed border-black/15 p-4 text-sm text-muted">
            No published insights for this place yet.
          </p>
        )}
      </div>

      <div className="mt-6 border-t border-black/5 pt-5">
        <p className="text-sm font-bold text-ink">Ask nearby</p>
        <div className="mt-3 flex gap-2">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-black/10 px-3 py-2.5 text-sm text-ink"
            aria-label="Nearby spatial question"
          />
          <button
            type="button"
            disabled={busy || question.trim().length < 3}
            onClick={() => void runQuery()}
            className="rounded-xl bg-ink px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            Ask
          </button>
        </div>
        {queryResult ? (
          <div className="mt-3 rounded-2xl bg-surface p-4 text-sm text-ink">
            <p className="font-bold">{queryResult.answer}</p>
            {queryResult.unavailableReason ? (
              <p className="mt-2 text-xs text-muted">
                No invented conditions—only published observations are used.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
