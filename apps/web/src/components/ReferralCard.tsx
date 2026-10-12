"use client";

// PARITY: mobile — referral link UI is web-only for this phase.

import { useCallback, useEffect, useState } from "react";
import { hasProAccess } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { fetchReferralInfo } from "@/lib/billing";

export function ReferralCard() {
  const { profile } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pro = profile ? hasProAccess(profile) : false;

  const reload = useCallback(async () => {
    if (!pro) return;
    try {
      const info = await fetchReferralInfo();
      setUrl(info.url);
      setCount(info.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load referral");
    }
  }, [pro]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!profile || !pro || profile.plan === "team_member") return null;

  async function onCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy link");
    }
  }

  return (
    <section className="mb-6 rounded-3xl border border-black/5 bg-card px-5 py-6 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
        Referrals
      </p>
      <h2 className="mt-1 text-lg font-bold tracking-tight text-ink">
        Share Nearby
      </h2>
      <p className="mt-2 text-sm text-muted">
        When someone you refer finishes their trial and pays, you get one free
        month. Conversions: {count}
      </p>
      {url ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <p className="min-w-0 flex-1 truncate rounded-2xl bg-surface px-3 py-3 text-sm text-ink">
            {url}
          </p>
          <button
            type="button"
            onClick={() => void onCopy()}
            className="rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">Referral link appears after Pro activates.</p>
      )}
      {error ? (
        <p className="mt-3 rounded-2xl bg-coral-soft px-3 py-2 text-sm text-coral">
          {error}
        </p>
      ) : null}
    </section>
  );
}
