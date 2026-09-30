import type { CSSProperties } from "react";
import type { MatchProfile } from "@/lib/types";
import { CompatibilityScore } from "./CompatibilityScore";

type ProfileCardProps = {
  profile: MatchProfile;
  selected?: boolean;
  displayScore?: number;
  onSelect?: () => void;
  style?: CSSProperties;
};

export function ProfileCard({
  profile,
  selected = false,
  displayScore,
  onSelect,
  style,
}: ProfileCardProps) {
  const score = displayScore ?? profile.score;

  return (
    <button
      type="button"
      onClick={onSelect}
      style={style}
      className={[
        "animate-fade-up w-full rounded-3xl border bg-card p-4 text-left shadow-sm transition-all duration-300",
        selected
          ? "border-teal/30 shadow-[0_12px_32px_-16px_rgba(13,148,136,0.45)] ring-2 ring-teal/20"
          : "border-black/5 hover:border-black/10 hover:shadow-md",
      ].join(" ")}
    >
      <div className="flex gap-3.5">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-inner"
          style={{
            background: `linear-gradient(145deg, hsl(${profile.avatarHue} 55% 52%), hsl(${profile.avatarHue} 60% 38%))`,
          }}
          aria-hidden
        >
          {profile.initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="truncate text-lg font-bold tracking-tight text-ink">
              {profile.name}
            </h2>
            <span className="text-sm font-medium text-muted">{profile.age}</span>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">{profile.role}</p>
        </div>

        {!selected && (
          <div className="shrink-0 self-start rounded-full bg-surface px-2.5 py-1 text-xs font-semibold tabular-nums text-muted">
            {profile.score}%
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {profile.interests.map((interest) => (
          <span
            key={interest}
            className={[
              "rounded-full px-2.5 py-1 text-xs font-medium",
              selected
                ? "bg-teal-soft text-teal"
                : "bg-surface text-muted",
            ].join(" ")}
          >
            {interest}
          </span>
        ))}
      </div>

      {selected && (
        <CompatibilityScore score={score} caption={profile.vibeCaption} />
      )}
    </button>
  );
}
