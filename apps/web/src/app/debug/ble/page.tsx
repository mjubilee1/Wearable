"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CLIP_RSSI_CLOSE_DBM } from "@nearby/shared";
import { TabBar } from "@/components/TabBar";
import { useAuth } from "@/lib/auth-context";
import { fetchClipSightings } from "@/lib/sightings";

function statusLabel(close: boolean, green: boolean): string {
  if (green) return "Green · close + similar";
  if (close) return "Close · not similar yet";
  return "Not close";
}

function statusClass(close: boolean, green: boolean): string {
  if (green) return "bg-emerald-500";
  if (close) return "bg-amber-glow";
  return "bg-muted";
}

export default function BleDebugPage() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["ble-sightings", user?.uid],
    enabled: Boolean(user),
    refetchInterval: 3000,
    queryFn: fetchClipSightings,
  });

  const reports = query.data ?? [];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-16 pt-20 sm:px-8">
      <header className="mb-8 max-w-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
          Debug
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">
          BLE reports
        </h1>
        <p className="mt-2 text-sm text-muted sm:text-base">
          What your phone already heard over Bluetooth and posted to the API.
          No names — clip id, RSSI, close / green only. The website does not
          scan radios. Close threshold: {CLIP_RSSI_CLOSE_DBM} dBm.
        </p>
        <p className="mt-3 text-sm text-muted">
          <Link href="/activity" className="font-semibold text-teal">
            ← Activity
          </Link>
          {" · "}
          <Link href="/profile" className="font-semibold text-teal">
            Profile interests
          </Link>
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-3">
        {query.isLoading ? (
          <p className="rounded-2xl bg-card px-5 py-8 text-sm text-muted shadow-sm">
            Loading reports…
          </p>
        ) : null}

        {query.isError ? (
          <p className="rounded-2xl bg-coral-soft px-5 py-4 text-sm text-coral">
            {query.error instanceof Error
              ? query.error.message
              : "Could not load sightings"}
          </p>
        ) : null}

        {!query.isLoading && reports.length === 0 ? (
          <p className="rounded-2xl bg-card px-5 py-8 text-sm text-muted shadow-sm">
            No sightings yet. Open the phone app in the foreground near a Stage
            1 XIAO (manufacturer FF FF N B…).
          </p>
        ) : null}

        <ul className="space-y-2">
          {reports.map((report) => (
            <li
              key={`${report.remoteClipId}-${report.timestamp}`}
              className="flex items-center gap-3 rounded-2xl border border-black/5 bg-card px-4 py-3 shadow-sm"
            >
              <span
                className={[
                  "h-3 w-3 shrink-0 rounded-full",
                  statusClass(report.close, report.green),
                ].join(" ")}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-semibold tracking-wide text-ink">
                  {report.remoteClipId}
                </p>
                <p className="text-[12px] text-muted">
                  {report.rssi} dBm · {statusLabel(report.close, report.green)}
                  {" · "}
                  {new Date(report.timestamp).toLocaleTimeString()}
                </p>
              </div>
              {report.green ? (
                <span className="rounded-full bg-teal-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal">
                  Green
                </span>
              ) : report.close ? (
                <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                  Close
                </span>
              ) : (
                <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                  Far
                </span>
              )}
            </li>
          ))}
        </ul>
      </main>

      <TabBar active="activity" />
    </div>
  );
}
