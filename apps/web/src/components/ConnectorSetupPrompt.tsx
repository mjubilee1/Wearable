"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  CONNECTOR_CATALOG,
  type ConnectorId,
  readConnectorSetup,
  shouldPromptConnectorSetup,
  startGoogleCalendarConnect,
  writeConnectorSetup,
} from "@/lib/connectors";

export function ConnectorSetupPrompt() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ConnectorId[]>([
    "google_calendar",
    "google_tasks",
    "gmail",
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) {
      setOpen(false);
      return;
    }
    if (pathname === "/" || pathname.startsWith("/login")) {
      setOpen(false);
      return;
    }
    setOpen(shouldPromptConnectorSetup(user.uid));
  }, [user, loading, pathname]);

  if (!open || !user) return null;

  function toggle(id: ConnectorId) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function dismiss(favorites: ConnectorId[]) {
    writeConnectorSetup(user!.uid, {
      favorites,
      dismissedAt: Date.now(),
    });
    setOpen(false);
  }

  const wantsGoogle = selected.some((id) =>
    ["google_calendar", "google_tasks", "gmail"].includes(id),
  );

  async function saveAndContinue() {
    dismiss(selected);
    if (wantsGoogle) {
      router.push("/connectors");
    }
  }

  async function saveAndConnectGoogle() {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    const withGoogle = Array.from(
      new Set<ConnectorId>([
        ...selected,
        "google_calendar",
        "google_tasks",
        "gmail",
      ]),
    );
    dismiss(withGoogle);
    try {
      const url = await startGoogleCalendarConnect(await user.getIdToken());
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google connect");
      setBusy(false);
      router.push("/connectors");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connector-setup-title"
        className="w-full max-w-md rounded-3xl bg-card p-6 shadow-lg"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
          Welcome
        </p>
        <h2
          id="connector-setup-title"
          className="mt-2 text-2xl font-bold tracking-tight text-ink"
        >
          Add your favorite connectors
        </h2>
        <p className="mt-2 text-sm text-muted">
          Choose what Nearby should be ready to use. Google unlocks Calendar,
          Tasks, and Gmail in one connect.
        </p>

        <ul className="mt-5 space-y-2">
          {CONNECTOR_CATALOG.map((item) => {
            const on = selected.includes(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  className={[
                    "flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition",
                    on
                      ? "border-teal/40 bg-teal-soft"
                      : "border-black/10 bg-white",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold",
                      on
                        ? "border-teal bg-teal text-white"
                        : "border-black/15 text-transparent",
                    ].join(" ")}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-ink">
                      {item.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {item.blurb}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {error ? <p className="mt-3 text-sm text-coral">{error}</p> : null}

        <div className="mt-5 flex flex-col gap-2">
          {wantsGoogle ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveAndConnectGoogle()}
              className="rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Opening Google…" : "Save & connect Google"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveAndContinue()}
            className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            Save favorites
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => dismiss(selected)}
            className="rounded-2xl px-4 py-2 text-sm font-semibold text-muted"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
