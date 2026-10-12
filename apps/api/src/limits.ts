import {
  FREE_DAILY_DRAFTS,
  FREE_DAILY_REQUESTS,
  FREE_DAILY_RESCHEDULES,
  type LimitFeature,
} from "@nearby/shared";
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

export function freeLimit(feature: LimitFeature): number {
  if (feature === "requests") return FREE_DAILY_REQUESTS;
  if (feature === "reschedule") return FREE_DAILY_RESCHEDULES;
  return FREE_DAILY_DRAFTS;
}
