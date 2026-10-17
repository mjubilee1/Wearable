import { FREE_DAILY_REQUESTS, type LimitFeature } from "@nearby/shared";
import { dayBoundsInZone } from "./timezone.js";

export class LimitReachedError extends Error {
  readonly code = "limit_reached" as const;
  readonly feature: LimitFeature;
  readonly resetAt: string;

  constructor(feature: LimitFeature, timeZone: string, now = new Date()) {
    super("limit_reached");
    this.name = "LimitReachedError";
    this.feature = feature;
    this.resetAt = dayBoundsInZone(timeZone, 1, now).start.toISOString();
  }
}

/** Reschedules and email drafts spend the same daily pool as any other request. */
export function freeLimit(_feature: LimitFeature = "requests"): number {
  return FREE_DAILY_REQUESTS;
}
