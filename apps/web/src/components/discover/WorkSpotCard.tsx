"use client";

import {
  googleMapsWalkingDirections,
  statusLabel,
  walkMinutes,
  type WorkSpot,
} from "@nearby/shared";

function statusClasses(status: WorkSpot["status"]): string {
  if (status === "quiet") return "bg-teal-soft text-teal";
  if (status === "busy") return "bg-coral-soft text-coral";
  if (status === "normal") return "bg-amber-100 text-amber-700";
  return "bg-surface text-muted";
}

export function WorkSpotCard({
  spot,
  onOpen,
}: {
  spot: WorkSpot;
  onOpen: () => void;
}) {
  const status = spot.status;
  const line = spot.hasLiveReading
    ? spot.lastReadMinutesAgo !== null
      ? `Read ${spot.lastReadMinutesAgo} min ago`
      : spot.typicalLine
    : spot.typicalLine;

  return (
    <article className="border border-ink/10 bg-card px-4 py-4">
      <button type="button" onClick={onOpen} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-ink">{spot.name}</h3>
            <p className="mt-1 text-sm text-muted">{line}</p>
          </div>
          {status ? (
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses(status)}`}
            >
              {statusLabel(status)}
              {spot.statusSource === "example" ? " · Example" : ""}
            </span>
          ) : (
            <span className="shrink-0 text-xs text-muted">No reading yet</span>
          )}
        </div>
        <p className="mt-2 text-sm text-muted">
          {walkMinutes(spot.distanceMeters)} min walk
          {spot.tags.length ? ` · ${spot.tags.join(" · ")}` : ""}
        </p>
        {!spot.hasLiveReading ? (
          <p className="mt-2 text-sm font-medium text-teal">
            Be the first to read this spot
          </p>
        ) : null}
      </button>
      <a
        href={googleMapsWalkingDirections(spot)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block border border-ink/15 px-3 py-2 text-sm font-semibold text-ink"
      >
        Directions
      </a>
    </article>
  );
}
