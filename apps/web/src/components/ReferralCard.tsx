"use client";

// PARITY: mobile — Pro billing and referrals remain web-only for this phase.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hasProAccess } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type ReferralSummary = {
  code: string;
  count: number;
};

export function ReferralCard() {
  const { user, profile } = useAuth();
  const [copied, setCopied] = useState(false);
  const pro = profile ? hasProAccess(profile) : false;
  const query = useQuery({
    queryKey: ["referrals", user?.uid],
    enabled: Boolean(user && pro),
    queryFn: async (): Promise<ReferralSummary> => {
      if (!user) throw new Error("Sign in first");
      const response = await fetch(`${API_URL}/v1/referrals`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      });
      const data = (await response.json()) as ReferralSummary & {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Could not load referrals");
      return data;
    },
  });

  if (!pro) return null;
  const path = query.data ? `/r/${query.data.code}` : null;
  const link =
    path && typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="mb-6 rounded-3xl border border-black/5 bg-card px-5 py-6 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
        Referrals
      </p>
      <h2 className="mt-1 text-lg font-bold tracking-tight text-ink">
        Give a trial, get an invoice free
      </h2>
      <p className="mt-2 text-sm text-muted">
        When a referred trial becomes paid, your next invoice is 100% off.
      </p>
      {query.isLoading ? (
        <p className="mt-4 text-sm text-muted">Loading your link…</p>
      ) : query.error ? (
        <p className="mt-4 text-sm text-coral">{query.error.message}</p>
      ) : (
        <>
          <div className="mt-4 flex gap-2">
            <input
              readOnly
              aria-label="Referral link"
              value={link ?? ""}
              className="min-w-0 flex-1 rounded-2xl border border-black/10 bg-surface px-3 py-2 text-sm text-ink"
            />
            <button
              type="button"
              onClick={() => void copyLink()}
              className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-3 text-sm text-muted">
            {query.data?.count ?? 0} paid{" "}
            {(query.data?.count ?? 0) === 1 ? "referral" : "referrals"}
          </p>
        </>
      )}
    </section>
  );
}
