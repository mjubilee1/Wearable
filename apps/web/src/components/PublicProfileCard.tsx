"use client";

import type { ReactNode } from "react";
import type { PublicProfilePreview } from "@nearby/shared";

type PublicProfileCardProps = {
  profile: PublicProfilePreview;
  message?: string;
  footer?: ReactNode;
};

function Avatar({ profile }: { profile: PublicProfilePreview }) {
  if (profile.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={profile.photoUrl}
        alt=""
        className="h-14 w-14 shrink-0 rounded-2xl object-cover"
      />
    );
  }

  return (
    <div
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-inner"
      style={{
        background: `linear-gradient(145deg, hsl(${profile.avatarHue} 55% 52%), hsl(${profile.avatarHue} 60% 38%))`,
      }}
      aria-hidden
    >
      {profile.initials}
    </div>
  );
}

export function PublicProfileCard({
  profile,
  message,
  footer,
}: PublicProfileCardProps) {
  return (
    <article className="rounded-3xl border border-black/5 bg-card p-4 shadow-sm">
      <div className="flex gap-3.5">
        <Avatar profile={profile} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="truncate text-lg font-bold tracking-tight text-ink">
              {profile.name}
            </h2>
            <span className="text-sm font-medium text-muted">{profile.age}</span>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">{profile.role}</p>
          {profile.lookingFor ? (
            <p className="mt-1 text-xs font-medium text-teal">
              Open to {profile.lookingFor.toLowerCase()}
            </p>
          ) : null}
        </div>
      </div>

      {profile.bio ? (
        <p className="mt-3 text-sm leading-snug text-ink/85">{profile.bio}</p>
      ) : null}

      {(profile.interests.length > 0 || (profile.vibes?.length ?? 0) > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {profile.vibes?.map((vibe) => (
            <span
              key={`v-${vibe}`}
              className="rounded-full bg-teal-soft px-2.5 py-1 text-xs font-medium text-teal"
            >
              {vibe}
            </span>
          ))}
          {profile.interests.map((interest) => (
            <span
              key={interest}
              className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-muted"
            >
              {interest}
            </span>
          ))}
        </div>
      )}

      {profile.prompts && profile.prompts.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {profile.prompts.slice(0, 2).map((prompt) => (
            <li key={prompt.id} className="rounded-2xl bg-surface/80 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                {prompt.question}
              </p>
              <p className="mt-0.5 text-sm text-ink">{prompt.answer}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {message ? (
        <blockquote className="mt-3 rounded-2xl border border-teal/20 bg-teal-soft/40 px-3.5 py-3 text-sm text-ink">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal">
            Their hello
          </p>
          <p className="mt-1 leading-snug">“{message}”</p>
        </blockquote>
      ) : null}

      {footer ? <div className="mt-4">{footer}</div> : null}
    </article>
  );
}
