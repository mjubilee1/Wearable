"use client";

// PARITY: mobile — upgrade sheet when the API returns limit_reached.

import { useState } from "react";
import {
  limitReachedMessage,
  type LimitFeature,
} from "@nearby/shared";
import { startProCheckout } from "@/lib/billing";
import { trackFunnel } from "@/lib/funnel";

export function UpgradeSheet({
  feature,
  onClose,
}: {
  feature: LimitFeature;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onStart() {
    setError(null);
    setBusy(true);
    trackFunnel("upgrade_click", { plan: "pro_monthly", feature });
    try {
      const url = await startProCheckout("month");
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-title"
        className="w-full max-w-md rounded-3xl bg-card p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
          Pro
        </p>
        <h2
          id="upgrade-title"
          className="mt-2 text-xl font-bold tracking-tight text-ink"
        >
          {limitReachedMessage(feature)}
        </h2>
        {error ? <p className="mt-3 text-sm text-coral">{error}</p> : null}
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onStart()}
            className="w-full rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Opening checkout…" : "Start free trial"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="w-full rounded-2xl border border-black/10 bg-card px-4 py-3 text-sm font-semibold text-ink disabled:opacity-60"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
