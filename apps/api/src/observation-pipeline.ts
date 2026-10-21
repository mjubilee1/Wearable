import { createHash, randomUUID } from "node:crypto";
import {
  MAX_IMAGE_OBSERVATION_BASE64_CHARS,
  MAX_IMAGE_OBSERVATION_BYTES,
  PLACE_MATCH_PUBLISH_THRESHOLD,
  attributesForIntent,
  distanceMeters,
  informationClassFor,
  insightTextFor,
  isGeoPoint,
  isLocationAccuracyUsable,
  isObservationExpired,
  parseSpatialQueryIntent,
  retentionMsFor,
  type ConfidenceAssessment,
  type NearbySpatialPlace,
  type ObservationCost,
  type ObservationFeedback,
  type ObservationSubmission,
  type PerceptionAttribute,
  type PlaceInsightsResponse,
  type PlaceMatchAssessment,
  type SpatialInsight,
  type SpatialObservation,
  type SpatialQueryResult,
  type SubmitImageObservationRequest,
  type VisionAttributeKey,
} from "@nearby/shared";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";
import {
  getSpatialPlaceById,
  nearbyPlaces,
  parseNearbyPlaceQuery,
} from "./places.js";
import {
  VisionError,
  createVisionProvider,
  type VisionPerceptionProvider,
} from "./vision.js";

const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;
const PUBLISH_LISTENERS = new Map<string, Set<(insight: SpatialInsight) => void>>();
const memorySubmissions = new Map<string, ObservationSubmission & { userId: string }>();
const memoryObservations = new Map<string, SpatialObservation & { userId: string }>();
const memoryFeedback = new Map<string, ObservationFeedback & { userId: string; createdAt: string }>();
const memoryJobs = new Map<string, ReturnType<typeof setTimeout>>();
const rateCounters = new Map<string, { count: number; resetAt: number }>();
const deadLetters: Array<{ submissionId: string; error: string; at: string }> = [];

export const observationMetrics = {
  submissions: 0,
  published: 0,
  failed: 0,
  duplicates: 0,
  estimatedUsd: 0,
  deadLetters: 0,
};

export class ObservationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "observation_error",
  ) {
    super(message);
  }
}

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

function nowIso(now = Date.now()): string {
  return new Date(now).toISOString();
}

async function enforceRateLimit(userId: string): Promise<void> {
  const now = Date.now();
  const bucket = Math.floor(now / RATE_WINDOW_MS);
  if (isFirebaseConfigured()) {
    const db = getFirebaseAdmin().firestore();
    const ref = db
      .collection("rateLimits")
      .doc(
        createHash("sha256")
          .update(`${userId}:observations:${bucket}`)
          .digest("hex"),
      );
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const count = Number(snapshot.data()?.count ?? 0);
      if (count >= RATE_LIMIT) {
        throw new ObservationError(
          "Too many observation submissions. Try again in a minute.",
          429,
          "rate_limited",
        );
      }
      transaction.set(ref, {
        uid: userId,
        action: "observation-submit",
        count: count + 1,
        expiresAt: (bucket + 1) * RATE_WINDOW_MS,
      });
    });
    return;
  }
  const current = rateCounters.get(userId);
  if (!current || current.resetAt <= now) {
    rateCounters.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  if (current.count >= RATE_LIMIT) {
    throw new ObservationError(
      "Too many observation submissions. Try again in a minute.",
      429,
      "rate_limited",
    );
  }
  current.count += 1;
}

function validateImage(request: SubmitImageObservationRequest): {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  dataBase64: string;
  bytes: number;
  sha256: string;
} {
  const mediaType = request.image?.mediaType;
  const dataBase64 = request.image?.dataBase64?.replace(/\s+/g, "") ?? "";
  if (
    mediaType !== "image/jpeg" &&
    mediaType !== "image/png" &&
    mediaType !== "image/webp"
  ) {
    throw new ObservationError("Only JPEG, PNG, or WebP images are supported.");
  }
  if (!dataBase64 || dataBase64.length > MAX_IMAGE_OBSERVATION_BASE64_CHARS) {
    throw new ObservationError("Image payload is missing or too large.");
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(dataBase64)) {
    throw new ObservationError("Image payload is not valid base64.");
  }
  const bytes = Buffer.byteLength(dataBase64, "base64");
  if (bytes < 32 || bytes > MAX_IMAGE_OBSERVATION_BYTES) {
    throw new ObservationError(
      `Image must be between 32 bytes and ${MAX_IMAGE_OBSERVATION_BYTES} bytes after compression.`,
    );
  }
  return {
    mediaType,
    dataBase64,
    bytes,
    sha256: createHash("sha256").update(dataBase64).digest("hex"),
  };
}

function validateLocation(location: SubmitImageObservationRequest["location"]) {
  if (
    !location ||
    !isGeoPoint({
      latitude: location.latitude,
      longitude: location.longitude,
      ...(location.accuracyMeters != null
        ? { accuracyMeters: location.accuracyMeters }
        : {}),
    })
  ) {
    throw new ObservationError("A valid observation location is required.");
  }
  if (!isLocationAccuracyUsable(location.accuracyMeters)) {
    throw new ObservationError(
      "Location accuracy is too low to associate this observation with a place.",
    );
  }
}

export function assessPlaceMatch(input: {
  location: { latitude: number; longitude: number; accuracyMeters: number | null };
  candidates: NearbySpatialPlace[];
  candidatePlaceId?: string | null;
}): PlaceMatchAssessment {
  const accuracy = input.location.accuracyMeters ?? 75;
  const ranked = [...input.candidates].sort(
    (a, b) => a.distanceMeters - b.distanceMeters,
  );
  if (input.candidatePlaceId) {
    const selected = ranked.find((place) => place.id === input.candidatePlaceId);
    if (!selected) {
      return {
        state: "unmatched",
        placeId: null,
        confidence: 0,
        candidateCount: ranked.length,
        distanceMeters: null,
        reasons: ["The selected place is not among nearby candidates."],
        alternatives: ranked.slice(0, 3).map((place) => ({
          placeId: place.id,
          name: place.name,
          distanceMeters: place.distanceMeters,
        })),
      };
    }
    const confidence = Math.max(
      0,
      Math.min(1, 0.95 - selected.distanceMeters / Math.max(40, accuracy * 4)),
    );
    return {
      state: confidence >= PLACE_MATCH_PUBLISH_THRESHOLD ? "matched" : "ambiguous",
      placeId: selected.id,
      confidence: Number(confidence.toFixed(3)),
      candidateCount: ranked.length,
      distanceMeters: selected.distanceMeters,
      reasons: [
        "User selected a nearby place.",
        selected.distanceMeters <= accuracy
          ? "Selected place is within GPS accuracy."
          : "Selected place is outside GPS accuracy and needs review.",
      ],
      alternatives: ranked
        .filter((place) => place.id !== selected.id)
        .slice(0, 3)
        .map((place) => ({
          placeId: place.id,
          name: place.name,
          distanceMeters: place.distanceMeters,
        })),
    };
  }

  if (!ranked.length) {
    return {
      state: "unmatched",
      placeId: null,
      confidence: 0,
      candidateCount: 0,
      distanceMeters: null,
      reasons: ["No nearby places were available for matching."],
      alternatives: [],
    };
  }

  const nearest = ranked[0];
  const second = ranked[1];
  const gap = second
    ? second.distanceMeters - nearest.distanceMeters
    : Number.POSITIVE_INFINITY;
  const nearEnough = nearest.distanceMeters <= Math.max(35, accuracy);
  const clearlyCloser = gap >= Math.max(20, accuracy * 0.5);
  const confidence = Number(
    Math.max(
      0,
      Math.min(
        1,
        (nearEnough ? 0.55 : 0.2) +
          (clearlyCloser ? 0.3 : 0) +
          Math.max(0, 0.2 - nearest.distanceMeters / 250),
      ),
    ).toFixed(3),
  );

  if (!nearEnough || !clearlyCloser || confidence < PLACE_MATCH_PUBLISH_THRESHOLD) {
    return {
      state: "ambiguous",
      placeId: null,
      confidence,
      candidateCount: ranked.length,
      distanceMeters: nearest.distanceMeters,
      reasons: [
        "Nearest place alone is not enough for automatic assignment.",
        clearlyCloser
          ? "Distance gap is clear but still below the publish threshold."
          : "Adjacent places are too close to choose automatically.",
      ],
      alternatives: ranked.slice(0, 3).map((place) => ({
        placeId: place.id,
        name: place.name,
        distanceMeters: place.distanceMeters,
      })),
    };
  }

  return {
    state: "matched",
    placeId: nearest.id,
    confidence,
    candidateCount: ranked.length,
    distanceMeters: nearest.distanceMeters,
    reasons: [
      "Nearest place is within GPS accuracy and clearly closer than alternatives.",
    ],
    alternatives: ranked.slice(1, 4).map((place) => ({
      placeId: place.id,
      name: place.name,
      distanceMeters: place.distanceMeters,
    })),
  };
}

export function assessConfidence(input: {
  perceptionConfidence: number;
  placeMatchConfidence: number;
  sourceReliability: number;
  observedAt: string;
  agreementCount: number;
  conflictCount: number;
  now?: number;
}): ConfidenceAssessment {
  const ageMs = Math.max(
    0,
    (input.now ?? Date.now()) - Date.parse(input.observedAt),
  );
  const recencyFactor = Math.exp(-ageMs / (6 * 60 * 60 * 1_000));
  const agreementBoost = Math.min(0.15, input.agreementCount * 0.05);
  const conflictPenalty = Math.min(0.45, input.conflictCount * 0.2);
  const score = Number(
    Math.max(
      0,
      Math.min(
        1,
        input.perceptionConfidence * 0.4 +
          input.placeMatchConfidence * 0.3 +
          input.sourceReliability * 0.15 +
          recencyFactor * 0.15 +
          agreementBoost -
          conflictPenalty,
      ),
    ).toFixed(3),
  );
  return {
    score,
    perceptionConfidence: input.perceptionConfidence,
    placeMatchConfidence: input.placeMatchConfidence,
    sourceReliability: input.sourceReliability,
    recencyFactor: Number(recencyFactor.toFixed(3)),
    independentAgreementCount: input.agreementCount,
    conflictCount: input.conflictCount,
    rules: [
      "Weighted transparent rules; not a calibrated probability.",
      "Conflicts reduce score instead of being discarded.",
      "Agreement across independent submissions can raise score slightly.",
    ],
  };
}

function verificationStatusFor(input: {
  confidence: ConfidenceAssessment;
  expiresAt: string | null;
  conflictCount: number;
  now?: number;
}): SpatialObservation["verificationStatus"] {
  if (input.conflictCount > 0) return "conflicting";
  if (isObservationExpired(input.expiresAt, input.now)) return "stale";
  if (input.confidence.score < 0.45) return "insufficient_evidence";
  if (input.confidence.score < 0.7) return "low_confidence";
  // "verified" is reserved for multi-source agreement under a defined threshold.
  if (
    input.confidence.independentAgreementCount >= 2 &&
    input.confidence.score >= 0.85
  ) {
    return "verified";
  }
  return "recent";
}

async function readSubmission(
  submissionId: string,
): Promise<(ObservationSubmission & { userId: string }) | null> {
  if (!isFirebaseConfigured()) {
    return memorySubmissions.get(submissionId) ?? null;
  }
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("observationSubmissions")
    .doc(submissionId)
    .get();
  if (!snap.exists) return null;
  return snap.data() as ObservationSubmission & { userId: string };
}

async function writeSubmission(
  submission: ObservationSubmission & { userId: string },
): Promise<void> {
  if (!isFirebaseConfigured()) {
    memorySubmissions.set(submission.id, submission);
    return;
  }
  await getFirebaseAdmin()
    .firestore()
    .collection("observationSubmissions")
    .doc(submission.id)
    .set(submission as unknown as Record<string, unknown>);
}

async function writeObservation(
  observation: SpatialObservation & { userId: string },
): Promise<void> {
  if (!isFirebaseConfigured()) {
    memoryObservations.set(observation.id, observation);
    return;
  }
  await getFirebaseAdmin()
    .firestore()
    .collection("spatialObservations")
    .doc(observation.id)
    .set(observation as unknown as Record<string, unknown>);
}

async function listPlaceObservations(
  placeId: string,
): Promise<Array<SpatialObservation & { userId: string }>> {
  const now = Date.now();
  if (!isFirebaseConfigured()) {
    return [...memoryObservations.values()].filter(
      (row) =>
        row.placeId === placeId &&
        row.publishedAt &&
        !isObservationExpired(row.expiresAt, now),
    );
  }
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("spatialObservations")
    .where("placeId", "==", placeId)
    .limit(100)
    .get();
  return snap.docs
    .map((doc) => doc.data() as SpatialObservation & { userId: string })
    .filter(
      (row) =>
        Boolean(row.publishedAt) && !isObservationExpired(row.expiresAt, now),
    );
}

async function findDuplicate(
  userId: string,
  imageSha256: string,
): Promise<(ObservationSubmission & { userId: string }) | null> {
  if (!isFirebaseConfigured()) {
    return (
      [...memorySubmissions.values()].find(
        (row) =>
          row.userId === userId &&
          row.imageSha256 === imageSha256 &&
          row.state !== "failed",
      ) ?? null
    );
  }
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("observationSubmissions")
    .where("userId", "==", userId)
    .where("imageSha256", "==", imageSha256)
    .limit(5)
    .get();
  return (
    (snap.docs
      .map((doc) => doc.data() as ObservationSubmission & { userId: string })
      .find((row) => row.state !== "failed") ?? null)
  );
}

function toInsight(observation: SpatialObservation): SpatialInsight {
  return {
    id: `insight_${observation.id}`,
    placeId: observation.placeId,
    attribute: observation.attribute,
    text: insightTextFor(observation),
    value: observation.value,
    informationClass: observation.informationClass,
    verificationStatus: observation.verificationStatus,
    confidence: observation.confidence,
    observedAt: observation.observedAt,
    expiresAt: observation.expiresAt,
    sourceLabel:
      observation.sourceType === "user_image"
        ? "Authorized photo observation"
        : observation.sourceType === "structured_provider"
          ? "OpenStreetMap structured attribute"
          : observation.sourceType,
    evidence: observation.evidence,
  };
}

function notifyListeners(placeId: string, insight: SpatialInsight): void {
  for (const listener of PUBLISH_LISTENERS.get(placeId) ?? []) {
    listener(insight);
  }
}

export function subscribePlaceInsights(
  placeId: string,
  listener: (insight: SpatialInsight) => void,
): () => void {
  const set = PUBLISH_LISTENERS.get(placeId) ?? new Set();
  set.add(listener);
  PUBLISH_LISTENERS.set(placeId, set);
  return () => {
    set.delete(listener);
    if (!set.size) PUBLISH_LISTENERS.delete(placeId);
  };
}

async function countAgreementAndConflicts(input: {
  placeId: string;
  attribute: VisionAttributeKey;
  value: string | number | boolean;
  userId: string;
}): Promise<{ agreementCount: number; conflictCount: number }> {
  const rows = await listPlaceObservations(input.placeId);
  const sameAttribute = rows.filter((row) => row.attribute === input.attribute);
  const agreementCount = new Set(
    sameAttribute
      .filter((row) => row.value === input.value && row.userId !== input.userId)
      .map((row) => row.userId),
  ).size;
  const conflictCount = new Set(
    sameAttribute
      .filter((row) => row.value !== input.value)
      .map((row) => row.userId),
  ).size;
  return { agreementCount, conflictCount };
}

async function processSubmission(
  submissionId: string,
  image: { mediaType: "image/jpeg" | "image/png" | "image/webp"; dataBase64: string },
  provider: VisionPerceptionProvider = createVisionProvider(),
): Promise<void> {
  const submission = await readSubmission(submissionId);
  if (!submission || submission.state === "published") return;

  try {
    submission.state = "validating";
    submission.attempts += 1;
    submission.updatedAt = nowIso();
    await writeSubmission(submission);

    const places = await nearbyPlaces(
      submission.userId,
      parseNearbyPlaceQuery({
        latitude: String(submission.location.latitude),
        longitude: String(submission.location.longitude),
        radiusMeters: "1000",
        limit: "20",
      }),
      { skipRateLimit: true },
    );

    const placeMatch = assessPlaceMatch({
      location: submission.location,
      candidates: places.places,
      candidatePlaceId: submission.candidatePlaceId,
    });
    submission.placeMatch = placeMatch;
    submission.state =
      placeMatch.state === "matched" ? "matched" : "processing";
    submission.updatedAt = nowIso();
    await writeSubmission(submission);

    submission.state = "processing";
    submission.updatedAt = nowIso();
    await writeSubmission(submission);

    const analysis = await provider.analyze({
      observationId: submission.id,
      mediaType: image.mediaType,
      dataBase64: image.dataBase64,
    });
    submission.perception = analysis.result;
    submission.cost = {
      provider: provider.name,
      model: provider.model,
      inputTokens: analysis.usage.inputTokens,
      outputTokens: analysis.usage.outputTokens,
      estimatedUsd: analysis.usage.estimatedUsd,
      latencyMs: analysis.usage.latencyMs,
    } satisfies ObservationCost;
    observationMetrics.estimatedUsd += analysis.usage.estimatedUsd;

    if (placeMatch.state !== "matched" || !placeMatch.placeId) {
      submission.state = "review_required";
      submission.updatedAt = nowIso();
      await writeSubmission(submission);
      return;
    }

    const published: SpatialObservation[] = [];
    for (const attribute of analysis.result.attributes) {
      const { agreementCount, conflictCount } = await countAgreementAndConflicts({
        placeId: placeMatch.placeId,
        attribute: attribute.key,
        value: attribute.value,
        userId: submission.userId,
      });
      const confidence = assessConfidence({
        perceptionConfidence: attribute.confidence,
        placeMatchConfidence: placeMatch.confidence,
        sourceReliability: 0.7,
        observedAt: submission.createdAt,
        agreementCount,
        conflictCount,
      });
      const expiresAt = nowIso(
        Date.parse(submission.createdAt) + retentionMsFor(attribute.key),
      );
      const observation: SpatialObservation & { userId: string } = {
        id: id("observation"),
        submissionId: submission.id,
        placeId: placeMatch.placeId,
        attribute: attribute.key,
        value: attribute.value,
        informationClass: informationClassFor(attribute.key),
        sourceType: "user_image",
        confidence: confidence.score,
        confidenceAssessment: confidence,
        observedAt: submission.createdAt,
        processedAt: nowIso(),
        evidenceRef: `sha256:${submission.imageSha256}`,
        evidence: attribute.evidence,
        expiresAt,
        verificationStatus: verificationStatusFor({
          confidence,
          expiresAt,
          conflictCount,
        }),
        publishedAt: null,
        userId: submission.userId,
      };
      if (
        confidence.score >= 0.55 &&
        observation.verificationStatus !== "insufficient_evidence"
      ) {
        observation.publishedAt = nowIso();
        published.push(observation);
      }
      await writeObservation(observation);
      submission.observationIds.push(observation.id);
      if (observation.publishedAt) {
        notifyListeners(observation.placeId, toInsight(observation));
        observationMetrics.published += 1;
      }
    }

    submission.state = published.length ? "published" : "review_required";
    submission.updatedAt = nowIso();
    await writeSubmission(submission);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Observation processing failed.";
    submission.state = "failed";
    submission.errorCode =
      error instanceof VisionError ? error.code : "processing_failed";
    submission.errorMessage = message;
    submission.updatedAt = nowIso();
    await writeSubmission(submission);
    observationMetrics.failed += 1;
    if (submission.attempts >= 3) {
      deadLetters.push({
        submissionId,
        error: message,
        at: nowIso(),
      });
      observationMetrics.deadLetters += 1;
      return;
    }
    if (error instanceof VisionError && error.retryable) {
      const delay = 400 * 2 ** Math.max(0, submission.attempts - 1);
      const handle = setTimeout(() => {
        void processSubmission(submissionId, image, provider);
      }, delay);
      memoryJobs.set(submissionId, handle);
    }
  }
}

export async function submitImageObservation(
  userId: string,
  request: SubmitImageObservationRequest,
  provider: VisionPerceptionProvider = createVisionProvider(),
): Promise<ObservationSubmission> {
  await enforceRateLimit(userId);
  validateLocation(request.location);
  const image = validateImage(request);
  const observedAt = request.observedAt ?? nowIso();
  if (
    Number.isNaN(Date.parse(observedAt)) ||
    Date.parse(observedAt) > Date.now() + 5 * 60 * 1_000 ||
    Date.parse(observedAt) < Date.now() - 24 * 60 * 60 * 1_000
  ) {
    throw new ObservationError("Observation timestamp is outside the accepted window.");
  }

  const duplicate = await findDuplicate(userId, image.sha256);
  if (duplicate) {
    observationMetrics.duplicates += 1;
    return {
      ...duplicate,
      duplicateOf: duplicate.id,
    };
  }

  const submission: ObservationSubmission & { userId: string } = {
    id: id("submission"),
    state: "received",
    location: {
      latitude: request.location.latitude,
      longitude: request.location.longitude,
      accuracyMeters: request.location.accuracyMeters,
      timestamp: request.location.timestamp || observedAt,
    },
    candidatePlaceId: request.candidatePlaceId ?? null,
    placeMatch: null,
    perception: null,
    observationIds: [],
    imageRetained: false,
    imageSha256: image.sha256,
    attempts: 0,
    duplicateOf: null,
    errorCode: null,
    errorMessage: null,
    cost: null,
    createdAt: observedAt,
    updatedAt: observedAt,
    userId,
  };
  await writeSubmission(submission);
  observationMetrics.submissions += 1;

  // Process asynchronously without retaining the image in durable storage.
  const handle = setTimeout(() => {
    void processSubmission(
      submission.id,
      { mediaType: image.mediaType, dataBase64: image.dataBase64 },
      provider,
    );
  }, 0);
  memoryJobs.set(submission.id, handle);
  return submission;
}

export async function getObservationSubmission(
  userId: string,
  submissionId: string,
): Promise<ObservationSubmission> {
  const submission = await readSubmission(submissionId);
  if (!submission || submission.userId !== userId) {
    throw new ObservationError("Observation not found.", 404, "not_found");
  }
  const { userId: _userId, ...publicSubmission } = submission;
  return publicSubmission;
}

export async function getPlaceInsights(
  placeId: string,
): Promise<PlaceInsightsResponse> {
  if (!(await getSpatialPlaceById(placeId)) && !placeId.startsWith("osm_")) {
    throw new ObservationError("Place not found.", 404, "not_found");
  }
  const observations = await listPlaceObservations(placeId);
  const byAttribute = new Map<string, SpatialObservation>();
  for (const observation of observations) {
    const current = byAttribute.get(observation.attribute);
    if (!current || Date.parse(observation.observedAt) > Date.parse(current.observedAt)) {
      byAttribute.set(observation.attribute, observation);
    }
  }
  return {
    placeId,
    insights: [...byAttribute.values()].map(toInsight),
    generatedAt: nowIso(),
  };
}

export async function answerSpatialQuery(
  userId: string,
  question: string,
  location: { latitude: number; longitude: number },
  radiusMeters = 1_000,
): Promise<SpatialQueryResult> {
  if (!question.trim() || question.trim().length > 240) {
    throw new ObservationError("Ask a short location question.");
  }
  if (!isGeoPoint(location)) {
    throw new ObservationError("A valid location is required for spatial queries.");
  }
  const intent = parseSpatialQueryIntent(question);
  const wanted = attributesForIntent(intent);
  const nearby = await nearbyPlaces(
    userId,
    parseNearbyPlaceQuery({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      radiusMeters: String(radiusMeters),
      limit: "20",
    }),
  );

  const ranked: SpatialQueryResult["places"] = [];
  for (const place of nearby.places) {
    const insights = (await getPlaceInsights(place.id)).insights.filter((insight) =>
      wanted.includes(insight.attribute),
    );
    if (!insights.length) continue;
    const relevanceScore = Number(
      (
        insights.reduce((sum, insight) => sum + insight.confidence, 0) /
          insights.length -
        place.distanceMeters / 5_000
      ).toFixed(3),
    );
    ranked.push({ place, insights, relevanceScore });
  }
  ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);

  if (!ranked.length) {
    return {
      intent,
      answer:
        intent === "charging"
          ? "No reliable outlet observations are available nearby yet."
          : "No reliable observations answer that nearby question yet.",
      places: [],
      unavailableReason: "insufficient_evidence",
      generatedAt: nowIso(),
    };
  }

  const top = ranked[0];
  const primary = top.insights[0];
  return {
    intent,
    answer: `${top.place.name} (${top.place.distanceMeters} m): ${primary.text}`,
    places: ranked.slice(0, 5),
    unavailableReason: null,
    generatedAt: nowIso(),
  };
}

export async function ingestStructuredPlaceAttributes(
  placeId: string,
): Promise<number> {
  const place = await getSpatialPlaceById(placeId);
  if (!place) return 0;
  let created = 0;
  const mappings: Array<{
    attribute: SpatialObservation["attribute"];
    raw: unknown;
  }> = [
    { attribute: "outdoor_seating", raw: place.attributes.outdoor_seating },
    { attribute: "wheelchair_access", raw: place.attributes.wheelchair },
  ];
  for (const mapping of mappings) {
    if (mapping.raw === undefined || mapping.raw === null || mapping.raw === "") {
      continue;
    }
    const value =
      mapping.attribute === "outdoor_seating"
        ? mapping.raw === true ||
          mapping.raw === "yes" ||
          mapping.raw === "true"
        : String(mapping.raw);
    const confidence = assessConfidence({
      perceptionConfidence: 0.75,
      placeMatchConfidence: 1,
      sourceReliability: 0.8,
      observedAt: place.lastSyncedAt,
      agreementCount: 0,
      conflictCount: 0,
    });
    const observation: SpatialObservation & { userId: string } = {
      id: id("observation"),
      submissionId: `structured_${place.id}_${mapping.attribute}`,
      placeId: place.id,
      attribute: mapping.attribute,
      value,
      informationClass: informationClassFor(mapping.attribute),
      sourceType: "structured_provider",
      confidence: confidence.score,
      confidenceAssessment: confidence,
      observedAt: place.lastSyncedAt,
      processedAt: nowIso(),
      evidenceRef: `osm:${place.providerPlaceId}`,
      evidence: `OpenStreetMap attribute ${mapping.attribute}=${String(mapping.raw)}`,
      expiresAt: nowIso(
        Date.now() + retentionMsFor(mapping.attribute),
      ),
      verificationStatus: "recent",
      publishedAt: nowIso(),
      userId: "structured-provider",
    };
    await writeObservation(observation);
    notifyListeners(place.id, toInsight(observation));
    created += 1;
  }
  return created;
}

export async function submitObservationFeedback(
  userId: string,
  feedback: ObservationFeedback,
): Promise<void> {
  if (!feedback.insightId || typeof feedback.helpful !== "boolean") {
    throw new ObservationError("Feedback requires insightId and helpful.");
  }
  const row = {
    ...feedback,
    note: feedback.note?.slice(0, 240),
    userId,
    createdAt: nowIso(),
  };
  if (!isFirebaseConfigured()) {
    memoryFeedback.set(`${userId}:${feedback.insightId}`, row);
    return;
  }
  await getFirebaseAdmin()
    .firestore()
    .collection("observationFeedback")
    .doc(`${userId}_${feedback.insightId}`)
    .set(row);
}

export function resetObservationPipelineForTest(): void {
  for (const handle of memoryJobs.values()) clearTimeout(handle);
  memoryJobs.clear();
  memorySubmissions.clear();
  memoryObservations.clear();
  memoryFeedback.clear();
  rateCounters.clear();
  deadLetters.length = 0;
  PUBLISH_LISTENERS.clear();
  observationMetrics.submissions = 0;
  observationMetrics.published = 0;
  observationMetrics.failed = 0;
  observationMetrics.duplicates = 0;
  observationMetrics.estimatedUsd = 0;
  observationMetrics.deadLetters = 0;
}

export async function waitForSubmissionState(
  submissionId: string,
  states: ObservationSubmission["state"][],
  timeoutMs = 2_000,
): Promise<ObservationSubmission & { userId: string }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const submission = await readSubmission(submissionId);
    if (submission && states.includes(submission.state)) return submission;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const latest = await readSubmission(submissionId);
  if (!latest) throw new Error("Submission missing");
  return latest;
}

export function __testOnlyDistance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  return distanceMeters(a, b);
}

export type { PerceptionAttribute };
