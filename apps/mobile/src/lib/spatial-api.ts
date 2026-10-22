import type {
  DataMode,
  EnvironmentalObservation,
  GeoPoint,
  NearbyArea,
  NodeType,
  ObservationNodePublic,
  SensorSession,
  SpatialSnapshot,
  NearbyPlacesResponse,
  ObservationSubmission,
  PlaceInsightsResponse,
  PlaceSearchResult,
  SpatialInsight,
  SpatialPlace,
  SpatialQueryResult,
  StartSensorSessionRequest,
  SubmitImageObservationRequest,
  SubmitObservationRequest,
} from "@nearby/shared";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

async function api<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? "Nearby Hello request failed.");
  return body as T;
}

function query(location: GeoPoint, mode: DataMode): string {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    mode,
  });
  if (location.accuracyMeters !== undefined) {
    params.set("accuracyMeters", String(location.accuracyMeters));
  }
  return params.toString();
}

export async function getSpatialSnapshot(
  token: string,
  location: GeoPoint,
  mode: DataMode,
): Promise<SpatialSnapshot> {
  const params = query(location, mode);
  const [aggregates, patterns] = await Promise.all([
    api<Pick<SpatialSnapshot, "zone" | "mode" | "aggregates" | "generatedAt">>(
      token,
      `/v1/spatial/aggregates?${params}`,
    ),
    api<Pick<SpatialSnapshot, "patterns">>(
      token,
      `/v1/spatial/patterns?${params}`,
    ),
  ]);
  return { ...aggregates, patterns: patterns.patterns };
}

export async function startSensorSession(
  token: string,
  request: StartSensorSessionRequest,
): Promise<SensorSession> {
  const body = await api<{ session: SensorSession }>(
    token,
    "/v1/spatial/sessions",
    { method: "POST", body: JSON.stringify(request) },
  );
  return body.session;
}

export async function stopSensorSession(
  token: string,
  sessionId: string,
): Promise<SensorSession> {
  const body = await api<{ session: SensorSession }>(
    token,
    `/v1/spatial/sessions/${encodeURIComponent(sessionId)}`,
    { method: "PATCH" },
  );
  return body.session;
}

export async function submitObservation(
  token: string,
  request: SubmitObservationRequest,
): Promise<EnvironmentalObservation> {
  const body = await api<{ observation: EnvironmentalObservation }>(
    token,
    "/v1/spatial/observations",
    { method: "POST", body: JSON.stringify(request) },
  );
  return body.observation;
}

export async function deleteSpatialContributions(token: string): Promise<number> {
  const body = await api<{ deleted: number }>(
    token,
    "/v1/spatial/contributions",
    { method: "DELETE" },
  );
  return body.deleted;
}

export async function getNearbyPlaces(
  token: string,
  location: GeoPoint,
  options: {
    radiusMeters?: number;
    category?: string | null;
    page?: number;
    limit?: number;
  } = {},
): Promise<NearbyPlacesResponse> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    radiusMeters: String(options.radiusMeters ?? 1_000),
    page: String(options.page ?? 1),
    limit: String(options.limit ?? 20),
  });
  if (options.category) params.set("category", options.category);
  return api<NearbyPlacesResponse>(
    token,
    `/v1/spatial/places/nearby?${params}`,
  );
}

export async function searchSpatialLocations(
  token: string,
  query: string,
): Promise<PlaceSearchResult[]> {
  const body = await api<{ results: PlaceSearchResult[] }>(
    token,
    `/v1/spatial/places/search?q=${encodeURIComponent(query)}`,
  );
  return body.results;
}

export async function submitImageObservation(
  token: string,
  request: SubmitImageObservationRequest,
): Promise<ObservationSubmission> {
  const body = await api<{ submission: ObservationSubmission }>(
    token,
    "/v1/spatial/observations",
    { method: "POST", body: JSON.stringify(request) },
  );
  return body.submission;
}

export async function getObservationSubmission(
  token: string,
  submissionId: string,
): Promise<ObservationSubmission> {
  const body = await api<{ submission: ObservationSubmission }>(
    token,
    `/v1/spatial/observations/${encodeURIComponent(submissionId)}`,
  );
  return body.submission;
}

export async function getPlaceInsights(
  token: string,
  placeId: string,
): Promise<PlaceInsightsResponse> {
  return api<PlaceInsightsResponse>(
    token,
    `/v1/spatial/places/${encodeURIComponent(placeId)}/insights`,
  );
}

export type PlaceDetailResponse = {
  place: SpatialPlace;
  insights: SpatialInsight[];
  generatedAt: string;
};

export async function getPlaceDetail(
  token: string,
  placeId: string,
): Promise<PlaceDetailResponse> {
  return api<PlaceDetailResponse>(
    token,
    `/v1/spatial/places/${encodeURIComponent(placeId)}`,
  );
}

export async function askSpatialQuery(
  token: string,
  question: string,
  location: GeoPoint,
  radiusMeters = 1_000,
): Promise<SpatialQueryResult> {
  return api<SpatialQueryResult>(token, "/v1/spatial/query", {
    method: "POST",
    body: JSON.stringify({ question, location, radiusMeters }),
  });
}

export async function getNearbyAreas(
  token: string,
  location: GeoPoint,
): Promise<{ areas: NearbyArea[]; generatedAt: string }> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
  });
  if (location.accuracyMeters !== undefined) {
    params.set("accuracyMeters", String(location.accuracyMeters));
  }
  return api(token, `/v1/spatial/areas/nearby?${params.toString()}`);
}

export async function listObservationNodes(
  token: string,
): Promise<{ nodes: ObservationNodePublic[] }> {
  return api(token, "/v1/spatial/nodes/me");
}

export async function registerObservationNode(
  token: string,
  body: {
    nodeType: NodeType;
    installationId: string;
    claimedCapabilities: string[];
    consent: { version: string; location: boolean; motion: boolean };
  },
): Promise<{ node: ObservationNodePublic }> {
  return api(token, "/v1/spatial/nodes/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function pauseObservationNode(
  token: string,
  nodeId: string,
): Promise<{ node: ObservationNodePublic }> {
  return api(token, "/v1/spatial/nodes/pause", {
    method: "POST",
    body: JSON.stringify({ nodeId }),
  });
}

export async function revokeObservationNode(
  token: string,
  nodeId: string,
): Promise<{ node: ObservationNodePublic }> {
  return api(token, "/v1/spatial/nodes/revoke", {
    method: "POST",
    body: JSON.stringify({ nodeId }),
  });
}

export async function submitNodeObservations(
  token: string,
  body: { nodeId: string; observations: unknown[] },
): Promise<{ nodeStatus: string; results: Array<{ status: string; code?: string }> }> {
  return api(token, "/v1/spatial/nodes/observations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function sendInsightFeedback(
  token: string,
  insightId: string,
  helpful: boolean,
  note?: string,
): Promise<void> {
  await api<{ ok: boolean }>(token, "/v1/spatial/insights/feedback", {
    method: "POST",
    body: JSON.stringify({ insightId, helpful, note }),
  });
}
