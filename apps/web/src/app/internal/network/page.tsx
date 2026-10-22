"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getNetworkReport, type NetworkReport } from "@/lib/spatial-api";

function project(
  point: { latitude: number; longitude: number },
  center: { latitude: number; longitude: number },
): { x: number; y: number } {
  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos((center.latitude * Math.PI) / 180);
  return {
    x: 50 + ((point.longitude - center.longitude) * lonScale) / 40,
    y: 50 - ((point.latitude - center.latitude) * latScale) / 40,
  };
}

export default function NetworkDashboardPage() {
  const { user, loading } = useAuth();
  const [report, setReport] = useState<NetworkReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await user.getIdToken();
        const next = await getNetworkReport(token);
        if (!cancelled) setReport(next);
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error && /not found/i.test(error.message)
              ? "This dashboard is limited to operators."
              : error instanceof Error
                ? error.message
                : "Could not load network metrics.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const coverage = report?.coverage.filter((area) => area.fresh) ?? [];
  const center = coverage[0]?.center;
  const stats = report
    ? [
        ["Registered nodes", report.nodes.registered],
        ["Active consenting nodes", report.nodes.activeConsenting],
        ["Observations received", report.observations.received],
        ["Observations accepted", report.observations.accepted],
        ["Observations rejected", report.observations.rejected],
        ["Ambiguous matches", report.matching.ambiguous],
        ["Match rate", report.matching.matchRate],
        ["Current insights", report.insights.current],
        ["Expired insights", report.insights.expired],
        ["Processing latency", `${report.processing.latencyMsAverage} ms`],
        ["Dead letters", report.processing.deadLetters],
        ["Provider failures", report.providers.overpassFailures],
        ["Estimated cost", `$${report.estimatedProcessingCostUsd.toFixed(2)}`],
      ]
    : [];

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-5 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal">
        Operator
      </p>
      <h1 className="mt-2 text-3xl font-semibold text-ink">Sensing network</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
        Aggregated node and processing metrics. This view does not show
        individual movement trails.
      </p>
      {loading ? <p className="mt-8 text-sm text-muted">Loading…</p> : null}
      {message ? <p className="mt-8 text-sm text-muted">{message}</p> : null}
      {report ? (
        <>
          <dl className="mt-8 grid gap-4 sm:grid-cols-3">
            {stats.map(([label, value]) => (
              <div key={String(label)} className="border border-ink/10 px-4 py-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-1 text-2xl font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-ink">Coverage</h2>
            {coverage.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No current area insights.</p>
            ) : (
              <div className="mt-4 grid gap-6 lg:grid-cols-[280px_1fr]">
                <div className="relative h-72 border border-ink/10 bg-surface">
                  {center
                    ? coverage.map((area) => {
                        const position = project(area.center, center);
                        return (
                          <span
                            key={area.areaId}
                            title={`${area.areaId}: ${area.participatingContributors} consenting accounts`}
                            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal"
                            style={{
                              left: `${Math.max(8, Math.min(92, position.x))}%`,
                              top: `${Math.max(8, Math.min(92, position.y))}%`,
                            }}
                          />
                        );
                      })
                    : null}
                </div>
                <ul className="space-y-3 text-sm">
                  {coverage.map((area) => (
                    <li key={area.areaId} className="border-t border-ink/10 pt-3">
                      <p className="font-medium text-ink">{area.value}</p>
                      <p className="text-muted">
                        {area.precision} · {area.participatingContributors} consenting
                        accounts · {area.coverage}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-ink">Sources</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {report.providers.sources.length === 0 ? (
                <li>No collection run has been recorded in this process.</li>
              ) : (
                report.providers.sources.map((source) => (
                  <li key={source.source}>
                    {source.source}: {source.status}. {source.detail}
                  </li>
                ))
              )}
            </ul>
            <p className="mt-4 text-sm text-muted">{report.costNote}</p>
          </section>
        </>
      ) : null}
    </main>
  );
}
