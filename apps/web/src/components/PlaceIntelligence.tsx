"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  intentForPlaceCategory,
  intentTitle,
  trustFromVerification,
  type SpatialInsight,
  type SpatialPlace,
} from "@nearby/shared";
import { TabBar } from "@/components/TabBar";
import { TrustBadge } from "@/components/TrustBadge";
import { useAuth } from "@/lib/auth-context";
import { getPlaceDetail } from "@/lib/spatial-api";

function groupInsights(insights: SpatialInsight[]) {
  const verified = insights.filter(
    (insight) => insight.verificationStatus === "verified",
  );
  const estimated = insights.filter((insight) =>
    ["recent", "low_confidence", "conflicting", "insufficient_evidence"].includes(
      insight.verificationStatus,
    ),
  );
  const historical = insights.filter(
    (insight) => insight.verificationStatus === "stale",
  );
  return { verified, estimated, historical };
}

export function PlaceIntelligence({ placeId }: { placeId: string }) {
  const { user } = useAuth();
  const [place, setPlace] = useState<SpatialPlace | null>(null);
  const [insights, setInsights] = useState<SpatialInsight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const detail = await getPlaceDetail(token, placeId);
        if (cancelled) return;
        setPlace(detail.place);
        setInsights(detail.insights);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Place not found.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [placeId, user]);

  const groups = useMemo(() => groupInsights(insights), [insights]);
  const intent = place ? intentForPlaceCategory(place.category) : "explore";

  return (
    <div className="app-shell mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pb-24 pt-20">
      <p className="mb-4 text-sm">
        <Link href="/nearby" className="text-muted hover:text-ink">
          Discover
        </Link>
      </p>

      {loading ? <p className="text-sm text-muted">Loading place…</p> : null}
      {error ? <p className="text-sm text-muted">{error}</p> : null}

      {place ? (
        <header className="mb-8 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {intentTitle(intent)}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            {place.name}
          </h1>
          <p className="text-sm capitalize text-muted">
            {place.category.replaceAll("_", " ")}
            {place.address ? ` · ${place.address}` : ""}
          </p>
          <p className="text-xs text-muted">
            Place identity from OpenStreetMap. Live crowd or seating claims only
            appear when observations support them.
          </p>
        </header>
      ) : null}

      {place ? (
        <main className="space-y-8">
          <InsightBlock
            title="Verified"
            empty="No verified observations yet."
            items={groups.verified}
          />
          <InsightBlock
            title="Estimated"
            empty="Nothing estimated for this place right now."
            items={groups.estimated}
          />
          <InsightBlock
            title="Historical"
            empty="No historical observations yet."
            items={groups.historical}
          />

          {!insights.length ? (
            <section className="border-t border-ink/10 pt-6">
              <TrustBadge label="unavailable" showHint />
              <p className="mt-3 text-sm text-muted">
                Check this spot when you are there to add an observation.
              </p>
            </section>
          ) : null}
        </main>
      ) : null}

      <TabBar active="nearby" />
    </div>
  );
}

function InsightBlock({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: SpatialInsight[];
}) {
  return (
    <section className="border-t border-ink/10 pt-6">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      {items.length ? (
        <ul className="mt-3 space-y-4">
          {items.map((insight) => (
            <li key={insight.id}>
              <p className="text-base text-ink">{insight.text}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <TrustBadge
                  label={trustFromVerification(insight.verificationStatus)}
                />
                <span className="text-xs text-muted">
                  {insight.sourceLabel} ·{" "}
                  {new Date(insight.observedAt).toLocaleString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      )}
    </section>
  );
}
