"use client";

type CompatibilityScoreProps = {
  score: number;
  caption: string;
};

function scoreColor(score: number): string {
  if (score < 35) return "#ef4444";
  if (score < 65) return "#f97316";
  return "#22c55e";
}

function scoreLabel(score: number): string {
  if (score < 35) return "Warming up";
  if (score < 65) return "Getting closer";
  return "Strong match";
}

export function CompatibilityScore({ score, caption }: CompatibilityScoreProps) {
  const color = scoreColor(score);
  const clamped = Math.max(0, Math.min(100, score));

  return (
    <div className="mt-4 space-y-2.5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Compatibility
          </p>
          <p className="mt-0.5 text-sm font-medium" style={{ color }}>
            {scoreLabel(clamped)}
          </p>
        </div>
        <p className="text-3xl font-bold tabular-nums tracking-tight text-ink">
          {Math.round(clamped)}
          <span className="text-lg font-semibold text-muted">%</span>
        </p>
      </div>

      <div
        className="h-3.5 overflow-hidden rounded-full bg-surface"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Compatibility score"
      >
        <div
          className="h-full rounded-full transition-[width,background-color] duration-700 ease-out"
          style={{
            width: `${clamped}%`,
            background: `linear-gradient(90deg, #ef4444 0%, #f97316 45%, #22c55e 100%)`,
            backgroundSize: `${10000 / Math.max(clamped, 1)}% 100%`,
          }}
        />
      </div>

      <p className="text-sm leading-snug text-muted">{caption}</p>
    </div>
  );
}
