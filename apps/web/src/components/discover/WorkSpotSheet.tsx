"use client";

import {
  googleMapsWalkingDirections,
  statusLabel,
  walkMinutes,
  type WorkSpot,
} from "@nearby/shared";
import { ReadSpotFlow } from "@/components/discover/ReadSpotFlow";

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
      className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto border-t border-ink/10 bg-white px-5 pb-8 pt-4 shadow-lg"
      role="dialog"
      aria-label={spot.name}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">
              {spot.neighborhoodLabel}
            </p>
            <h2 className="text-2xl font-semibold text-ink">{spot.name}</h2>
            <p className="text-sm text-muted">{spot.address}</p>
          </div>
          <button
            type="button"
            className="text-sm text-muted"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {status ? (
          <p className="text-lg font-semibold text-ink">
            {statusLabel(status)}
            {spot.statusSource === "example" ? (
              <span className="ml-2 text-sm font-normal text-muted">
                Example data
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-muted">Be the first to read this spot</p>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted">Typical day</h3>
          {hasTypical ? (
            <>
              <div className="flex items-end gap-1 overflow-x-auto pb-1">
                {spot.typicalDay.map((row) => (
                  <div key={row.hour} className="flex w-8 shrink-0 flex-col items-center gap-1">
                    <div
                      className={`h-10 w-full rounded-sm ${levelColor(row.level)}`}
                      title={`${hourLabel(row.hour)}: ${row.level}`}
                    />
                    <span className="text-[10px] text-muted">
                      {hourLabel(row.hour)}
                    </span>
                  </div>
                ))}
              </div>
              {spot.statusSource === "example" ? (
                <p className="text-xs text-muted">Example data</p>
              ) : null}
              {spot.bestTime ? (
                <p className="text-sm text-muted">Best time: {spot.bestTime}</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted">Not enough readings yet</p>
          )}
        </section>

        {spot.hasLiveReading && spot.lastReadMinutesAgo !== null ? (
          <p className="text-sm text-muted">
            Read {spot.lastReadMinutesAgo} min ago by{" "}
            {spot.contributorCount || 1}{" "}
            {spot.contributorCount === 1 ? "person" : "people"}
          </p>
        ) : (
          <p className="text-sm text-muted">{spot.typicalLine}</p>
        )}

        <p className="text-sm text-muted">
          {walkMinutes(spot.distanceMeters)} min walk · {spot.tags.join(" · ")}
        </p>

        <a
          href={googleMapsWalkingDirections(spot)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block border border-ink/15 px-4 py-2.5 text-sm font-semibold text-ink"
        >
          Directions
        </a>

        <ReadSpotFlow spot={spot} onClose={onClose} onComplete={onRefresh} />
      </div>
    </div>
  );
}
