"use client";

import { useEffect, useState } from "react";
import { NETWORK_CONSENT_VERSION, platformSensingNotes } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import {
  listObservationNodes,
  pauseObservationNode,
  registerObservationNode,
  revokeObservationNode,
} from "@/lib/spatial-api";
import {
  readSensingPrefs,
  writeSensingPrefs,
  type SensingPrefs,
} from "@/lib/sensing/session";

export function SensingNetworkSettings() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<SensingPrefs | null>(null);
  const [motion, setMotion] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notes = platformSensingNotes("WEB");

  useEffect(() => {
    const stored = readSensingPrefs();
    setPrefs(stored);
    setMotion(stored.motion);
  }, []);

  async function participate() {
    if (!user || !prefs) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const result = await registerObservationNode(token, {
        nodeType: "WEB",
        installationId: prefs.installationId,
        claimedCapabilities: [
          "location_foreground",
          "motion_estimate",
          "bluetooth_proximity",
          "wifi_presence",
          "background_location",
        ],
        consent: {
          version: NETWORK_CONSENT_VERSION,
          location: true,
          motion,
        },
      });
      const next: SensingPrefs = {
        ...prefs,
        status: result.node.status,
        location: true,
        motion,
      };
      writeSensingPrefs(next);
      setPrefs(next);
      setMessage(
        "Foreground sensing is on while Nearby Hello is open. You can pause or revoke it anytime.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not enable sensing.");
    } finally {
      setBusy(false);
    }
  }

  async function update(action: "pause" | "revoke") {
    if (!user || !prefs) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const existing = await listObservationNodes(token);
      for (const node of existing.nodes) {
        if (action === "pause" && node.status === "ACTIVE") {
          await pauseObservationNode(token, node.id);
        }
        if (action === "revoke" && node.status !== "REVOKED") {
          await revokeObservationNode(token, node.id);
        }
      }
      const next: SensingPrefs = {
        ...prefs,
        status: action === "pause" ? "PAUSED" : "REVOKED",
        location: action !== "revoke",
        motion: action === "revoke" ? false : prefs.motion,
      };
      writeSensingPrefs(next);
      setPrefs(next);
      setMessage(
        action === "pause"
          ? "Sensing is paused. Nearby Hello will not collect new observations."
          : "Consent is revoked. Collection has stopped.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update sensing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 space-y-4 border-t border-ink/10 pt-8">
      <div>
        <h2 className="text-lg font-semibold text-ink">Sensing network</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Optional. Nearby Hello works without it. While this tab is open, a
          consenting browser can contribute minimized location observations.
          This does not run in the background and does not scan nearby devices.
        </p>
      </div>
      <p className="text-sm text-muted">
        Status: {prefs?.status === "ACTIVE" ? "Participating" : prefs?.status === "PAUSED" ? "Paused" : prefs?.status === "REVOKED" ? "Revoked" : "Off"}
      </p>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-1"
          checked={motion}
          onChange={(event) => setMotion(event.target.checked)}
        />
        <span>
          Also share a motion estimate from this device. It describes this
          phone only, not people nearby.
        </span>
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void participate()}
          className="rounded-2xl bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          Participate
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void update("pause")}
          className="rounded-2xl border border-ink/15 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          Pause
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void update("revoke")}
          className="rounded-2xl border border-ink/15 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          Revoke consent
        </button>
      </div>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
      <ul className="space-y-2 text-xs leading-relaxed text-muted">
        {notes.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}
