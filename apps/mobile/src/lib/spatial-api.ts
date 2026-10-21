import type {
  DataMode,
  EnvironmentalObservation,
  GeoPoint,
  SensorSession,
  SpatialSnapshot,
  NearbyPlacesResponse,
  PlaceSearchResult,
  StartSensorSessionRequest,
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
