"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isEmailLikeName } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { updateUserProfile } from "@/lib/users";
import {
  CONNECTOR_CATALOG,
  type ConnectorId,
  readConnectorSetup,
  startGoogleCalendarConnect,
  writeConnectorSetup,
} from "@/lib/connectors";

const HIDDEN_PREFIXES = ["/login", "/signup", "/forgot-password", "/onboarding", "/pricing"];

export function ConnectorSetupPrompt() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const closed = useRef(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ConnectorId[]>([
    "google_calendar",
    "google_tasks",
    "gmail",
  ]);
  const [firstName, setFirstName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsName = Boolean(
    profile && isEmailLikeName(profile.name, profile.email || user?.email),
  );
  const choosable = CONNECTOR_CATALOG.filter((item) => !item.locked);
  const locked = CONNECTOR_CATALOG.filter((item) => item.locked);

  useEffect(() => {
    if (closed.current || loading || !user) {
      setOpen(false);
      return;
    }
    if (
      pathname === "/" ||
      HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    ) {
      setOpen(false);
      return;
    }
    const local = readConnectorSetup(user.uid);
    const profileDismissed =
      typeof profile?.connectorSetupDismissedAt === "number"
        ? profile.connectorSetupDismissedAt
        : null;
    if (profileDismissed != null || local.dismissedAt != null) {
      setOpen(false);
      if (profileDismissed != null && local.dismissedAt == null) {
        writeConnectorSetup(user.uid, {
          favorites: local.favorites.length
            ? local.favorites
            : ["notes"],
          dismissedAt: profileDismissed,
        });
      }
      return;
    }
    setOpen(true);
  }, [user, profile, loading, pathname]);

  const closeRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function toggle(id: ConnectorId) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function rememberDismiss(favorites: ConnectorId[]) {
    if (!user) return;
    const dismissedAt = Date.now();
    const withNotes = Array.from(new Set<ConnectorId>([...favorites, "notes"]));
    closed.current = true;
    setOpen(false);
    writeConnectorSetup(user.uid, {
      favorites: withNotes,
      dismissedAt,
    });
    void updateUserProfile(user.uid, {
      connectorSetupDismissedAt: dismissedAt,
    }).catch(() => {
      // localStorage already recorded the dismissal.
    });
  }

  async function saveName(required: boolean): Promise<boolean> {
    if (!profile || !needsName) return true;
    const trimmed = firstName.trim();
    if (!trimmed) {
      if (!required) return true;
      setError("Enter your first name.");
      return false;
    }
    if (isEmailLikeName(trimmed, profile.email || user?.email)) {
      setError("Use your first name, not your email.");
      return false;
    }
    await updateUserProfile(profile.id, { name: trimmed });
    await refreshProfile();
    return true;
  }

  async function close() {
    if (!user || busy || closed.current) return;
    setError(null);
    try {
      await saveName(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your name");
      return;
    }
    rememberDismiss(selected);
  }

  closeRef.current = () => {
    void close();
  };

  const wantsGoogle = selected.some((id) =>
    ["google_calendar", "google_tasks", "gmail"].includes(id),
  );

  async function saveAndContinue() {
    if (busy || closed.current) return;
    setError(null);
    try {
      const saved = await saveName(true);
      if (!saved) return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your name");
      return;
    }
    rememberDismiss(selected);
    if (wantsGoogle) router.push("/connectors");
  }

  async function saveAndConnectGoogle() {
    if (!user || busy || closed.current) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveName(true);
      if (!saved) {
        setBusy(false);
        return;
      }
      const withGoogle = Array.from(
        new Set<ConnectorId>([
          ...selected,
          "google_calendar",
          "google_tasks",
          "gmail",
        ]),
      );
      rememberDismiss(withGoogle);
      const url = await startGoogleCalendarConnect(await user.getIdToken());
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google connect");
      setBusy(false);
      if (closed.current) router.push("/connectors");
    }
  }

  if (!open || !user) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      onClick={() => void close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connector-setup-title"
        className="max-h-[min(100dvh-2rem,40rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-card p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
              Welcome
            </p>
            <h2
              id="connector-setup-title"
              className="mt-2 text-2xl font-bold tracking-tight text-ink"
            >
              Add your favorite connectors
            </h2>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void close()}
            className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
          >
            Close
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">
          Choose what Nearby should be ready to use. Google unlocks Calendar,
          Tasks, and Gmail in one connect.
        </p>

        {needsName ? (
          <label className="mt-5 block space-y-1.5">
            <span className="text-xs font-semibold text-ink">First name</span>
            <input
              value={firstName}
              autoComplete="given-name"
              onChange={(event) => setFirstName(event.target.value)}
              placeholder="Your first name"
              className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
            />
            <span className="block text-xs text-muted">
              Nearby uses this when it greets you.
            </span>
          </label>
        ) : null}

        <ul className="mt-5 space-y-2">
          {choosable.map((item) => {
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
                      {item.canDo}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {locked.map((item) => (
            <li key={item.id}>
              <div
                role="checkbox"
                aria-checked="true"
                aria-disabled="true"
                className="flex w-full items-start gap-3 rounded-2xl border border-teal/40 bg-teal-soft px-4 py-3 text-left"
              >
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-teal bg-teal text-[11px] font-bold text-white"
                  aria-hidden
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {item.name}
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                      Built in
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {item.canDo}
                  </span>
                </span>
              </div>
            </li>
          ))}
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
            onClick={() => void close()}
            className="rounded-2xl border border-black/10 px-4 py-3 text-sm font-semibold text-ink disabled:opacity-60"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
