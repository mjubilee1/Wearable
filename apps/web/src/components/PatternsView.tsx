"use client";

import { useCallback, useEffect, useState } from "react";
import type { SpatialSnapshot } from "@nearby/shared";
import { trustFromProvenance } from "@nearby/shared";
import { TabBar } from "@/components/TabBar";
import { TrustBadge } from "@/components/TrustBadge";
import { useAuth } from "@/lib/auth-context";
import { getSpatialSnapshot } from "@/lib/spatial-api";
import { useSpatialLocation } from "@/lib/use-spatial-location";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function PatternsView() {
  const { user } = useAuth();
  const spatial = useSpatialLocation();
  const [snapshot, setSnapshot] = useState<SpatialSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !spatial.ready) return;
    try {
      const token = await user.getIdToken();
      const mode = spatial.usingDevice ? "personal" : "demo";
      setSnapshot(await getSpatialSnapshot(token, spatial.location, mode));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not load patterns.");
    }
  }, [spatial.location, spatial.ready, spatial.usingDevice, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const patterns = snapshot?.patterns ?? [];

  return (
    <div className="app-shell mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pb-24 pt-20">
      <header className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Patterns
        </h1>
        <p className="text-base text-muted">
          What this area is usually like by time of day—only when enough
          readings exist.
        </p>
        <TrustBadge
          label={spatial.usingDevice ? "historical" : "example"}
          showHint
        />
      </header>

      <main className="space-y-5">
        {patterns.length ? (
          patterns.map((pattern) => (
            <div
              key={`${pattern.type}-${pattern.dayOfWeek}-${pattern.hour}`}
              className="border-t border-ink/10 pt-4"
            >
              <p className="text-sm text-muted">
                {WEEKDAYS[pattern.dayOfWeek]}{" "}
                {String(pattern.hour).padStart(2, "0")}:00
              </p>
              <p className="mt-1 text-xl font-semibold text-ink">
                {pattern.type === "sound_dbfs" ? "Usual quiet/loud" : "Usual movement"}{" "}
                · {Number(pattern.baseline).toFixed(0)}
              </p>
              <p className="mt-1 text-xs text-muted">
                From {pattern.sampleCount} readings ·{" "}
                {Math.round(pattern.confidence * 100)}% confidence
              </p>
              <div className="mt-2">
                <TrustBadge label={trustFromProvenance("historical")} />
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted">
            {message ??
              "Not enough history yet. Contributions over different hours unlock this view."}
          </p>
        )}
      </main>

      <TabBar active="patterns" />
    </div>
  );
}
