"use client";

import {
  googleMapsWalkingDirections,
  statusLabel,
  walkMinutes,
  type WorkSpot,
} from "@nearby/shared";
import {
  spotTypeAccent,
  spotTypeLabel,
  statusDot,
  statusSurface,
} from "@/components/discover/discover-ui";

export function WorkSpotCard({
  spot,
  onOpen,
}: {
  spot: WorkSpot;
  onOpen: () => void;
}) {
  const status = spot.status;
  const subtitle = spot.hasLiveReading
    ? spot.lastReadMinutesAgo !== null
      ? `Updated ${spot.lastReadMinutesAgo} min ago by ${spot.contributorCount || 1} ${spot.contributorCount === 1 ? "person" : "people"}`
      : spot.typicalLine
    : spot.typicalLine;

  return (
    <article
      className="overflow-hidden rounded-2xl border border-ink/8 bg-card shadow-[0_8px_30px_rgba(17,24,39,0.06)]"
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full px-4 pb-3 pt-4 text-left transition hover:bg-surface/40"
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-xs font-bold uppercase tracking-wide ${spotTypeAccent(spot.type)}`}
          >
            {spot.type === "library" ? "Lib" : spot.type === "coworking" ? "Co" : "Café"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {spotTypeLabel(spot.type)} · {walkMinutes(spot.distanceMeters)} min walk
                </p>
                <h3 className="mt-0.5 text-lg font-semibold leading-snug text-ink">
                  {spot.name}
                </h3>
              </div>
              {status ? (
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusSurface(status)}`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${statusDot(status)}`}
                    aria-hidden
                  />
                  {statusLabel(status)}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink/75">{subtitle}</p>
            {spot.statusSource === "example" ? (
              <p className="mt-1 text-xs font-medium text-muted">
                Example pattern · tap for typical day
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {spot.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-ink/80"
                >
                  {tag}
                </span>
              ))}
            </div>
            {!spot.hasLiveReading ? (
              <p className="mt-3 text-sm font-semibold text-teal">
                Be the first to read this spot →
              </p>
            ) : null}
          </div>
        </div>
      </button>
      <div className="flex gap-2 border-t border-ink/6 bg-surface/30 px-3 py-3">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 rounded-xl bg-ink px-3 py-2.5 text-sm font-semibold text-white"
        >
          See details
        </button>
        <a
          href={googleMapsWalkingDirections(spot)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-xl border border-ink/12 bg-white px-3 py-2.5 text-center text-sm font-semibold text-ink"
        >
          Directions
        </a>
      </div>
    </article>
  );
}
