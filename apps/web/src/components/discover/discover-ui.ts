import type { WorkSpot, WorkSpotStatus } from "@nearby/shared";

export function spotTypeLabel(type: WorkSpot["type"]): string {
  if (type === "library") return "Library";
  if (type === "coworking") return "Coworking";
  return "Café";
}

export function spotTypeAccent(type: WorkSpot["type"]): string {
  if (type === "library") return "bg-teal/10 text-teal border-teal/20";
  if (type === "coworking") return "bg-ink/5 text-ink border-ink/10";
  return "bg-amber-100/80 text-amber-900 border-amber-200/80";
}

export function statusDot(status: WorkSpotStatus): string {
  if (status === "quiet") return "bg-teal";
  if (status === "busy") return "bg-coral";
  return "bg-amber-glow";
}

export function statusSurface(status: WorkSpotStatus): string {
  if (status === "quiet") return "bg-teal-soft/80 text-teal border-teal/25";
  if (status === "busy") return "bg-coral-soft text-coral border-coral/25";
  return "bg-amber-50 text-amber-900 border-amber-200/70";
}
