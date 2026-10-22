import type { InsightProvenance } from "./spatial.js";
import type {
  ObservationVerificationStatus,
  SpatialInsight,
} from "./spatial-intelligence.js";

/** How a discovery card should be labeled in the UI. Never invent live facts. */
export type TrustLabel =
  | "verified"
  | "estimated"
  | "historical"
  | "example"
  | "unavailable";

export function trustFromProvenance(
  provenance: InsightProvenance,
): TrustLabel {
  switch (provenance) {
    case "measured":
      return "verified";
    case "estimated":
      return "estimated";
    case "historical":
      return "historical";
    case "demonstration":
      return "example";
    case "unavailable":
      return "unavailable";
  }
}

export function trustFromVerification(
  status: ObservationVerificationStatus,
): TrustLabel {
  switch (status) {
    case "verified":
      return "verified";
    case "recent":
      return "estimated";
    case "low_confidence":
    case "conflicting":
    case "insufficient_evidence":
      return "estimated";
    case "stale":
      return "historical";
  }
}

export function trustLabelCopy(label: TrustLabel): string {
  switch (label) {
    case "verified":
      return "Verified";
    case "estimated":
      return "Estimated";
    case "historical":
      return "Historical";
    case "example":
      return "Example";
    case "unavailable":
      return "Unavailable";
  }
}

export function trustLabelHint(label: TrustLabel): string {
  switch (label) {
    case "verified":
      return "Supported by published observations.";
    case "estimated":
      return "Interpreted from limited or recent signals—not a live guarantee.";
    case "historical":
      return "Based on past patterns for this time.";
    case "example":
      return "Demonstration data so you can see how Nearby Hello looks.";
    case "unavailable":
      return "Not enough real observations yet.";
  }
}

export function insightHeadline(insight: SpatialInsight): string {
  return insight.text;
}

/** Intent buckets for the Discover feed, without claiming live occupancy. */
export type DiscoveryIntent =
  | "work"
  | "social"
  | "relax"
  | "explore"
  | "atmosphere";

export function intentForPlaceCategory(category: string): DiscoveryIntent {
  const value = category.toLowerCase();
  if (
    value.includes("cafe") ||
    value.includes("library") ||
    value.includes("cowork") ||
    value.includes("office")
  ) {
    return "work";
  }
  if (
    value.includes("bar") ||
    value.includes("pub") ||
    value.includes("nightclub") ||
    value.includes("restaurant")
  ) {
    return "social";
  }
  if (value.includes("park") || value.includes("garden")) {
    return "relax";
  }
  return "explore";
}

export function intentTitle(intent: DiscoveryIntent): string {
  switch (intent) {
    case "work":
      return "Work-friendly";
    case "social":
      return "Social atmosphere";
    case "relax":
      return "Calm spot";
    case "explore":
      return "Worth a look";
    case "atmosphere":
      return "Local atmosphere";
  }
}
