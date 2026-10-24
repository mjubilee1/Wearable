import type {
  WorkSpotNeighborhoodId,
  WorkSpotsResponse,
  WorkSpotStatus,
} from "@nearby/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function getWorkSpots(
  options: {
    latitude: number;
    longitude: number;
    neighborhood: WorkSpotNeighborhoodId;
    token?: string | null;
  },
): Promise<WorkSpotsResponse> {
  const params = new URLSearchParams({
    latitude: String(options.latitude),
    longitude: String(options.longitude),
    neighborhood: options.neighborhood,
  });
  const response = await fetch(`${API_URL}/v1/spatial/work-spots?${params}`, {
    headers: options.token
      ? { Authorization: `Bearer ${options.token}` }
      : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as WorkSpotsResponse & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error ?? "Couldn't load work spots.");
  }
  return body;
}

export async function submitWorkSpotReading(
  spotId: string,
  input: {
    loudness: number;
    status: WorkSpotStatus;
    tags: string[];
  },
): Promise<void> {
  const response = await fetch(
    `${API_URL}/v1/spatial/work-spots/${encodeURIComponent(spotId)}/readings`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not save your reading.");
  }
}
