type DeviceStripProps = {
  score: number;
};

function lightFromScore(score: number): { label: string; color: string } {
  if (score < 35) return { label: "Cool red", color: "#ef4444" };
  if (score < 65) return { label: "Warm amber", color: "#f59e0b" };
  return { label: "Bright green", color: "#22c55e" };
}

export function DeviceStrip({ score }: DeviceStripProps) {
  const light = lightFromScore(score);

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-black/5 bg-card px-3.5 py-3 shadow-sm">
      <div
        className="h-3 w-3 shrink-0 rounded-full animate-pulse-glow"
        style={{ backgroundColor: light.color }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-ink">Wearable · BLE connected</p>
        <p className="truncate text-[11px] text-muted">
          Score light: {light.label}
        </p>
      </div>
      <span className="rounded-full bg-teal-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal">
        Live
      </span>
    </div>
  );
}
