type DeviceStripProps = {
  score: number;
  /** Linked wearable short id, e.g. A1B2. BLE pairing itself is mobile-only. */
  deviceId?: string | null;
};

function lightFromScore(score: number): { label: string; color: string } {
  if (score < 35) return { label: "Cool red", color: "#ef4444" };
  if (score < 65) return { label: "Warm amber", color: "#f59e0b" };
  return { label: "Bright green", color: "#22c55e" };
}

export function DeviceStrip({ score, deviceId }: DeviceStripProps) {
  const linked = Boolean(deviceId);
  const light = lightFromScore(score);

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-black/5 bg-card px-3.5 py-3 shadow-sm">
      <div
        className="h-3 w-3 shrink-0 rounded-full animate-pulse-glow"
        style={{ backgroundColor: linked ? light.color : "#6b7280" }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-ink">
          {linked ? `Wearable · NB-${deviceId}` : "Wearable · Not linked"}
        </p>
        <p className="truncate text-[11px] text-muted">
          {linked
            ? `Score light: ${light.label}`
            : "Add your ring ID in Profile — phone app can auto-find it over Bluetooth"}
        </p>
      </div>
      <span
        className={[
          "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
          linked ? "bg-teal-soft text-teal" : "bg-surface text-muted",
        ].join(" ")}
      >
        {linked ? "Linked" : "Setup"}
      </span>
    </div>
  );
}
