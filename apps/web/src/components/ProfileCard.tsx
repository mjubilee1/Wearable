import type { CSSProperties } from "react";
import type { ConnectionRequestStatus } from "@nearby/shared";
import type { MatchProfile } from "@/lib/types";
import { CompatibilityScore } from "./CompatibilityScore";

type ProfileCardProps = {
  profile: MatchProfile;
  selected?: boolean;
  displayScore?: number;
  connectionStatus?: ConnectionRequestStatus | "none";
  onSelect?: () => void;
  onFacilitate?: () => void;
  onSayHello?: () => void;
  facilitateLoading?: boolean;
  style?: CSSProperties;
};

function statusLabel(status: ConnectionRequestStatus | "none" | undefined) {
  if (status === "pending") return "Hello sent";
  if (status === "accepted") return "Connected";
  if (status === "declined") return "Hello sent";
  return null;
}

export function ProfileCard({
  profile,
  selected = false,
  displayScore,
  connectionStatus = "none",
  onSelect,
  onFacilitate,
  onSayHello,
  facilitateLoading,
  style,
}: ProfileCardProps) {
  const score = displayScore ?? profile.score;
  const badge = statusLabel(connectionStatus);
  const canHello =
    connectionStatus === "none" ||
    connectionStatus === "cancelled" ||
    connectionStatus === "expired";

  return (
    <div
      style={style}
      className={[
        "animate-fade-up w-full rounded-3xl border bg-card p-4 text-left shadow-sm transition-all duration-300",
        selected
          ? "border-teal/30 shadow-[0_12px_32px_-16px_rgba(13,148,136,0.45)] ring-2 ring-teal/20"
          : "border-black/5 hover:border-black/10 hover:shadow-md",
      ].join(" ")}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex gap-3.5">
          {profile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photoUrl}
              alt=""
              className="h-14 w-14 shrink-0 rounded-2xl object-cover"
            />
          ) : (
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-inner"
              style={{
                background: `linear-gradient(145deg, hsl(${profile.avatarHue} 55% 52%), hsl(${profile.avatarHue} 60% 38%))`,
              }}
              aria-hidden
            >
              {profile.initials}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h2 className="truncate text-lg font-bold tracking-tight text-ink">
                {profile.name}
              </h2>
              <span className="text-sm font-medium text-muted">
                {profile.age}
              </span>
            </div>
            <p className="mt-0.5 truncate text-sm text-muted">{profile.role}</p>
            {profile.bio ? (
              <p className="mt-1 line-clamp-2 text-xs text-ink/80">
                {profile.bio}
              </p>
            ) : null}
          </div>

          {badge ? (
            <span className="shrink-0 self-start rounded-full bg-teal-soft px-2.5 py-1 text-[11px] font-semibold text-teal">
              {badge}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {profile.interests.map((interest) => (
            <span
              key={interest}
              className={[
                "rounded-full px-2.5 py-1 text-xs font-medium",
                selected ? "bg-teal-soft text-teal" : "bg-surface text-muted",
              ].join(" ")}
            >
              {interest}
            </span>
          ))}
        </div>

        <CompatibilityScore score={score} caption={profile.vibeCaption} />
      </button>

      {selected ? (
        <div className="mt-3 flex flex-col gap-2">
          {onFacilitate ? (
            <button
              type="button"
              onClick={onFacilitate}
              disabled={facilitateLoading}
              className="w-full rounded-2xl border border-teal/25 bg-teal-soft/60 px-3 py-2.5 text-xs font-semibold text-teal transition hover:bg-teal-soft disabled:opacity-60"
            >
              {facilitateLoading ? "Thinking…" : "Help me say hi"}
            </button>
          ) : null}
          {canHello && onSayHello ? (
            <button
              type="button"
              onClick={onSayHello}
              className="w-full rounded-2xl bg-teal px-3 py-2.5 text-xs font-semibold text-white transition hover:brightness-110"
            >
              Send a hello
            </button>
          ) : null}
          {!canHello && connectionStatus === "pending" ? (
            <p className="text-center text-xs text-muted">
              Waiting for them to review your profile
            </p>
          ) : null}
          {connectionStatus === "accepted" ? (
            <p className="text-center text-xs font-medium text-teal">
              You’re connected — see Connections
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
