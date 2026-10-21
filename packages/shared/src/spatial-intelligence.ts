import type { GeoPoint, NearbySpatialPlace, SpatialLocation } from "./spatial.js";

export const SUPPORTED_VISION_OBJECTS = [
  "electrical_outlet",
  "table",
  "chair",
  "unoccupied_seat",
  "person_in_queue",
  "workspace_surface",
] as const;

export const SUPPORTED_VISION_ATTRIBUTES = [
  "outlets_visible_count",
  "tables_visible_count",
  "seats_visible_count",
  "seats_appeared_unoccupied",
  "visible_queue_people",
  "setting",
] as const;
export const SUPPORTED_STRUCTURED_ATTRIBUTES = [
  "outdoor_seating",
  "wheelchair_access",
] as const;

export type VisionObjectType = (typeof SUPPORTED_VISION_OBJECTS)[number];
export type VisionAttributeKey = (typeof SUPPORTED_VISION_ATTRIBUTES)[number];
export type StructuredAttributeKey =
  (typeof SUPPORTED_STRUCTURED_ATTRIBUTES)[number];
export type SpatialAttributeKey = VisionAttributeKey | StructuredAttributeKey;
export type ObservationInformationClass = "static" | "dynamic" | "predicted";
export type ObservationSourceType =
  | "user_image"
  | "structured_provider"
  | "business"
  | "iot"
  | "prediction";
export type ObservationProcessingState =
  | "received"
  | "validating"
  | "processing"
  | "matched"
  | "review_required"
  | "published"
  | "failed";
export type ObservationVerificationStatus =
  | "verified"
  | "recent"
  | "low_confidence"
  | "stale"
  | "conflicting"
  | "insufficient_evidence";

export type PerceptionDetectedObject = {
  type: VisionObjectType;
  count: number;
  confidence: number;
};

export type PerceptionAttribute = {
  key: VisionAttributeKey;
  value: string | number | boolean;
  confidence: number;
  evidence: string;
};

export type PerceptionResult = {
  observationId: string;
  detectedObjects: PerceptionDetectedObject[];
  attributes: PerceptionAttribute[];
  limitations: string[];
  processedAt: string;
  model: string;
};

export type PlaceMatchAssessment = {
  state: "matched" | "ambiguous" | "unmatched";
  placeId: string | null;
  confidence: number;
  candidateCount: number;
  distanceMeters: number | null;
  reasons: string[];
  alternatives: Array<{
    placeId: string;
    name: string;
    distanceMeters: number;
  }>;
};

export type ConfidenceAssessment = {
  score: number;
  perceptionConfidence: number;
  placeMatchConfidence: number;
  sourceReliability: number;
  recencyFactor: number;
  independentAgreementCount: number;
  conflictCount: number;
  rules: string[];
};

export type SpatialObservation = {
  id: string;
  submissionId: string;
  placeId: string;
  attribute: SpatialAttributeKey;
  value: string | number | boolean;
  informationClass: ObservationInformationClass;
  sourceType: ObservationSourceType;
  confidence: number;
  confidenceAssessment: ConfidenceAssessment;
  observedAt: string;
  processedAt: string;
  evidenceRef: string;
  evidence: string;
  expiresAt: string | null;
  verificationStatus: ObservationVerificationStatus;
  publishedAt: string | null;
};

export type ObservationCost = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  latencyMs: number;
};

export type ObservationSubmission = {
  id: string;
  state: ObservationProcessingState;
  location: SpatialLocation;
  candidatePlaceId: string | null;
  placeMatch: PlaceMatchAssessment | null;
  perception: PerceptionResult | null;
  observationIds: string[];
  imageRetained: false;
  imageSha256: string;
  attempts: number;
  duplicateOf: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  cost: ObservationCost | null;
  createdAt: string;
  updatedAt: string;
};

export type SubmitImageObservationRequest = {
  image: {
    mediaType: "image/jpeg" | "image/png" | "image/webp";
    dataBase64: string;
  };
  location: SpatialLocation;
  candidatePlaceId?: string | null;
  observedAt?: string;
};

export type SpatialInsight = {
  id: string;
  placeId: string;
  attribute: SpatialAttributeKey;
  text: string;
  value: string | number | boolean;
  informationClass: ObservationInformationClass;
  verificationStatus: ObservationVerificationStatus;
  confidence: number;
  observedAt: string;
  expiresAt: string | null;
  sourceLabel: string;
  evidence: string;
};

export type PlaceInsightsResponse = {
  placeId: string;
  insights: SpatialInsight[];
  generatedAt: string;
};

export type SpatialQueryIntent =
  | "charging"
  | "seating"
  | "quiet_work"
  | "crowding"
  | "workspace"
  | "social"
  | "unknown";

export type SpatialQueryRequest = {
  question: string;
  location: GeoPoint;
  radiusMeters?: number;
};

export type SpatialQueryResult = {
  intent: SpatialQueryIntent;
  answer: string;
  places: Array<{
    place: NearbySpatialPlace;
    insights: SpatialInsight[];
    relevanceScore: number;
  }>;
  unavailableReason: string | null;
  generatedAt: string;
};

export function informationClassFor(
  attribute: SpatialAttributeKey,
): ObservationInformationClass {
  return attribute === "seats_appeared_unoccupied" ||
    attribute === "visible_queue_people"
    ? "dynamic"
    : "static";
}

export function retentionMsFor(attribute: SpatialAttributeKey): number {
  switch (attribute) {
    case "seats_appeared_unoccupied":
      return 15 * 60 * 1_000;
    case "visible_queue_people":
      return 5 * 60 * 1_000;
    case "outlets_visible_count":
      return 90 * 24 * 60 * 60 * 1_000;
    case "setting":
      return 180 * 24 * 60 * 60 * 1_000;
    case "outdoor_seating":
    case "wheelchair_access":
      return 180 * 24 * 60 * 60 * 1_000;
    default:
      return 30 * 24 * 60 * 60 * 1_000;
  }
}

export const PLACE_MATCH_PUBLISH_THRESHOLD = 0.78;
export const MAX_IMAGE_OBSERVATION_BYTES = 1_200_000;
export const MAX_IMAGE_OBSERVATION_BASE64_CHARS = 1_600_000;

export function isObservationExpired(
  expiresAt: string | null,
  now = Date.now(),
): boolean {
  if (!expiresAt) return false;
  const expires = Date.parse(expiresAt);
  return !Number.isFinite(expires) || expires <= now;
}

export function parseSpatialQueryIntent(question: string): SpatialQueryIntent {
  const text = question.toLowerCase();
  if (
    /charge|outlet|power|plug|laptop|electric/.test(text)
  ) {
    return "charging";
  }
  if (/seat|sit|table|chair|unoccupied|empty seat/.test(text)) {
    return "seating";
  }
  if (/quiet|work|workspace|study|focus/.test(text)) {
    return "quiet_work";
  }
  if (/crowd|busy|queue|line/.test(text)) return "crowding";
  if (/social|hang out|meet|bar|cafe/.test(text)) return "social";
  if (/workspace|cowork/.test(text)) return "workspace";
  return "unknown";
}

export function attributesForIntent(
  intent: SpatialQueryIntent,
): SpatialAttributeKey[] {
  switch (intent) {
    case "charging":
      return ["outlets_visible_count"];
    case "seating":
      return ["seats_appeared_unoccupied", "seats_visible_count", "tables_visible_count"];
    case "quiet_work":
      return ["setting", "seats_appeared_unoccupied", "outlets_visible_count"];
    case "crowding":
      return ["visible_queue_people"];
    case "workspace":
      return ["outlets_visible_count", "tables_visible_count", "setting"];
    case "social":
      return ["outdoor_seating", "seats_visible_count"];
    default:
      return [
        "outlets_visible_count",
        "seats_appeared_unoccupied",
        "visible_queue_people",
        "outdoor_seating",
        "setting",
      ];
  }
}

export function insightTextFor(observation: {
  attribute: SpatialAttributeKey;
  value: string | number | boolean;
  observedAt: string;
  informationClass: ObservationInformationClass;
}): string {
  const ageMs = Math.max(0, Date.now() - Date.parse(observation.observedAt));
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  const age =
    minutes < 60
      ? `${minutes} minute${minutes === 1 ? "" : "s"} ago`
      : `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? "" : "s"} ago`;

  switch (observation.attribute) {
    case "outlets_visible_count":
      return `${observation.value} outlet${observation.value === 1 ? "" : "s"} were detected in a recent photo. Visibility does not prove they work or are available for public use.`;
    case "tables_visible_count":
      return `${observation.value} table${observation.value === 1 ? "" : "s"} were visible in a photo taken ${age}.`;
    case "seats_visible_count":
      return `${observation.value} seat${observation.value === 1 ? "" : "s"} were visible in a photo taken ${age}.`;
    case "seats_appeared_unoccupied":
      return `${observation.value} seat${observation.value === 1 ? "" : "s"} appeared empty ${age}, but current availability is unknown.`;
    case "visible_queue_people":
      return `${observation.value} people appeared to be waiting in a queue ${age}. This is not a venue occupancy count.`;
    case "setting":
      return `This place looked ${String(observation.value)} in a photo taken ${age}.`;
    case "outdoor_seating":
      return observation.value
        ? "OpenStreetMap lists outdoor seating for this place."
        : "OpenStreetMap does not list outdoor seating for this place.";
    case "wheelchair_access":
      return `OpenStreetMap wheelchair access is marked as ${String(observation.value)}.`;
    default:
      return `A ${observation.informationClass} observation is available from ${age}.`;
  }
}

export type ObservationFeedback = {
  insightId: string;
  helpful: boolean;
  note?: string;
};
