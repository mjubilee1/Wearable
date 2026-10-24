"use client";

import {
  googleMapsWalkingDirections,
  statusLabel,
  walkMinutes,
  type WorkSpot,
} from "@nearby/shared";
import { ReadSpotFlow } from "@/components/discover/ReadSpotFlow";
import {
  spotTypeLabel,
  statusDot,
  statusSurface,
} from "@/components/discover/discover-ui";

function hourLabel(hour: number): string {
  if (hour === 12) return "12p";
  if (hour > 12) return `${hour - 12}p`;
  return `${hour}a`;
}

function levelColor(level: string): string {
  if (level === "quiet") return "bg-teal";
  if (level === "busy") return "bg-coral";
  return "bg-amber-400";
}

export function WorkSpotSheet({
  spot,
  onClose,
  onRefresh,
}: {
  spot: WorkSpot;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const hasTypical = spot.typicalDay.length > 0;
  const status = spot.status;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t border-ink/10 bg-white shadow-[0_-12px_40px_rgba(17,24,39,0.12)]"
      role="dialog"
      aria-label={spot.name}
    >
      <div className="sticky top-0 z-10 bg-white/95 px-5 pb-2 pt-3 backdrop-blur-sm">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink/15" />
        <div className="mx-auto flex w-full max-w-2xl items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              {spotTypeLabel(spot.type)} · {spot.neighborhoodLabel}
            </p>
            <h2 className="mt-1 text-2xl font-semibold leading-tight text-ink">
              {spot.name}
            </h2>
            <p className="mt-1 text-sm text-muted">{spot.address}</p>
          </div>
          <button
            type="button"
            className="rounded-full border border-ink/10 px-3 py-1.5 text-sm text-muted"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-5 pb-8">
        {status ? (
          <div
            className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${statusSurface(status)}`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${statusDot(status)}`} />
            {statusLabel(status)}
            {spot.statusSource === "example" ? (
              <span className="font-normal text-muted">· Example data</span>
            ) : null}
          </div>
        ) : (
          <p className="rounded-xl bg-teal-soft/50 px-3 py-2 text-sm font-medium text-teal">
            Be the first to read this spot
          </p>
        )}

        <section className="space-y-3 rounded-2xl border border-ink/8 bg-surface/40 p-4">
          <h3 className="text-sm font-semibold text-ink">Typical day (7a–10p)</h3>
          {hasTypical ? (
            <>
              <div className="flex items-end gap-1 overflow-x-auto pb-1">
                {spot.typicalDay.map((row) => (
                  <div
                    key={row.hour}
                    className="flex w-9 shrink-0 flex-col items-center gap-1"
                  >
                    <div
                      className={`h-12 w-full rounded-md ${levelColor(row.level)} opacity-90`}
                      title={`${hourLabel(row.hour)}: ${row.level}`}
                    />
                    <span className="text-[10px] font-medium text-muted">
                      {hourLabel(row.hour)}
                    </span>
                  </div>
                ))}
              </div>
              {spot.bestTime ? (
                <p className="text-sm text-ink/80">
                  <span className="font-semibold text-ink">Best time:</span>{" "}
                  {spot.bestTime}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted">Not enough readings yet</p>
          )}
        </section>

        {spot.hasLiveReading && spot.lastReadMinutesAgo !== null ? (
          <p className="text-sm text-ink/80">
            Read {spot.lastReadMinutesAgo} min ago by {spot.contributorCount || 1}{" "}
            {spot.contributorCount === 1 ? "person" : "people"}
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-ink/75">{spot.typicalLine}</p>
        )}

        <p className="text-sm text-muted">
          {walkMinutes(spot.distanceMeters)} min walk · {spot.tags.join(" · ")}
        </p>

        <a
          href={googleMapsWalkingDirections(spot)}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-xl bg-ink px-4 py-3 text-center text-sm font-semibold text-white"
        >
          Directions in Google Maps
        </a>

        <div className="rounded-2xl border border-ink/8 bg-white p-4">
          <ReadSpotFlow spot={spot} onClose={onClose} onComplete={onRefresh} />
        </div>
      </div>
    </div>
  );
}
