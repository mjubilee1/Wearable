import {
  SUPPORTED_VISION_ATTRIBUTES,
  SUPPORTED_VISION_OBJECTS,
  type PerceptionAttribute,
  type PerceptionDetectedObject,
  type PerceptionResult,
  type VisionAttributeKey,
  type VisionObjectType,
} from "@nearby/shared";

const MAX_MODEL_RESPONSE_CHARS = 20_000;

export type VisionAnalysisInput = {
  observationId: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  dataBase64: string;
};

export type VisionAnalysis = {
  result: PerceptionResult;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
    latencyMs: number;
  };
};

export interface VisionPerceptionProvider {
  readonly name: string;
  readonly model: string;
  analyze(input: VisionAnalysisInput): Promise<VisionAnalysis>;
}

export class VisionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "vision_not_configured"
      | "vision_provider_error"
      | "malformed_model_response"
      | "unsupported_image",
    readonly retryable = false,
  ) {
    super(message);
  }
}

function finiteConfidence(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}

function detectedObject(value: unknown): PerceptionDetectedObject | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.type !== "string" ||
    !(SUPPORTED_VISION_OBJECTS as readonly string[]).includes(row.type) ||
    typeof row.count !== "number" ||
    !Number.isInteger(row.count) ||
    row.count < 0 ||
    row.count > 100
  ) {
    return null;
  }
  const confidence = finiteConfidence(row.confidence);
  if (confidence === null) return null;
  return {
    type: row.type as VisionObjectType,
    count: row.count,
    confidence,
  };
}

function validAttributeValue(
  key: VisionAttributeKey,
  value: unknown,
): value is string | number | boolean {
  if (key === "setting") {
    return value === "indoor" || value === "outdoor" || value === "mixed";
  }
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
  );
}

function perceptionAttribute(value: unknown): PerceptionAttribute | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.key !== "string" ||
    !(SUPPORTED_VISION_ATTRIBUTES as readonly string[]).includes(row.key)
  ) {
    return null;
  }
  const key = row.key as VisionAttributeKey;
  const confidence = finiteConfidence(row.confidence);
  if (
    confidence === null ||
    !validAttributeValue(key, row.value) ||
    typeof row.evidence !== "string"
  ) {
    return null;
  }
  const evidence = row.evidence.replace(/\s+/g, " ").trim();
  if (evidence.length < 8 || evidence.length > 240) return null;
  return { key, value: row.value, confidence, evidence };
}

export function parsePerceptionResult(
  content: string,
  observationId: string,
  model: string,
  processedAt = new Date().toISOString(),
): PerceptionResult | null {
  const candidate = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  if (!candidate || candidate.length > MAX_MODEL_RESPONSE_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  if (
    !Array.isArray(row.detectedObjects) ||
    row.detectedObjects.length > 20 ||
    !Array.isArray(row.attributes) ||
    row.attributes.length > 20 ||
    !Array.isArray(row.limitations) ||
    row.limitations.length > 10
  ) {
    return null;
  }
  const detectedObjects = row.detectedObjects.map(detectedObject);
  const attributes = row.attributes.map(perceptionAttribute);
  if (
    detectedObjects.some((value) => value === null) ||
    attributes.some((value) => value === null)
  ) {
    return null;
  }
  const limitations = row.limitations.map((value) =>
    typeof value === "string"
      ? value.replace(/\s+/g, " ").trim().slice(0, 300)
      : "",
  );
  if (limitations.some((value) => !value)) return null;
  return {
    observationId,
    detectedObjects: detectedObjects as PerceptionDetectedObject[],
    attributes: attributes as PerceptionAttribute[],
    limitations,
    processedAt,
    model,
  };
}

function modelPrompt(): string {
  return `Analyze only visible, non-identifying features of this physical environment.

Allowed detectedObjects types:
electrical_outlet, table, chair, unoccupied_seat, person_in_queue, workspace_surface.

Allowed attributes:
- outlets_visible_count: count only clearly visible outlet fixtures. Visibility does not prove they work or are public.
- tables_visible_count: clearly visible tables.
- seats_visible_count: clearly visible seats.
- seats_appeared_unoccupied: seats visibly unoccupied in this image only; never claim current availability.
- visible_queue_people: people visibly arranged in a queue. Do not estimate total venue occupancy.
- setting: exactly indoor, outdoor, or mixed.

Do not infer Wi-Fi, sound, crowd level, demographics, identity, emotions, safety, ownership, business quality, or facts outside the frame. Omit unsupported attributes. Evidence must describe the visible basis without identifying a person.

Return JSON only:
{
  "detectedObjects": [{"type":"electrical_outlet","count":1,"confidence":0.8}],
  "attributes": [{"key":"outlets_visible_count","value":1,"confidence":0.8,"evidence":"One outlet fixture is visible on the wall."}],
  "limitations": ["The image does not establish whether an outlet works or is available for public use."]
}`;
}

/** Deterministic zero-cost provider for tests and keyless local development. */
export class FixtureVisionProvider implements VisionPerceptionProvider {
  readonly name = "fixture";
  readonly model = "fixture-v1";

  async analyze(input: VisionAnalysisInput): Promise<VisionAnalysis> {
    const startedAt = Date.now();
    const marker = Buffer.from(input.dataBase64, "base64").toString("utf8");
    let attributes: PerceptionAttribute[] = [];
    let detectedObjects: PerceptionDetectedObject[] = [];
    let limitations = [
      "Fixture vision only returns attributes encoded for local testing.",
      "A visible outlet does not prove it works or is available for public use.",
    ];

    if (marker.includes("FIXTURE_OUTLETS_2")) {
      detectedObjects = [
        { type: "electrical_outlet", count: 2, confidence: 0.91 },
        { type: "chair", count: 3, confidence: 0.84 },
      ];
      attributes = [
        {
          key: "outlets_visible_count",
          value: 2,
          confidence: 0.91,
          evidence: "Two outlet fixtures are visible on the wall in the fixture image.",
        },
        {
          key: "seats_appeared_unoccupied",
          value: 2,
          confidence: 0.8,
          evidence: "Two chairs appear empty in the fixture image.",
        },
        {
          key: "setting",
          value: "indoor",
          confidence: 0.88,
          evidence: "Interior walls and furniture are visible in the fixture image.",
        },
      ];
    } else if (marker.includes("FIXTURE_EMPTY")) {
      limitations = [
        "No supported physical attributes were visible in the fixture image.",
      ];
    } else if (marker.includes("FIXTURE_MALFORMED")) {
      throw new VisionError(
        "Vision provider returned malformed or unsupported attributes.",
        "malformed_model_response",
      );
    } else {
      // Unknown images stay empty rather than inventing attributes.
      limitations = [
        "No supported attributes could be extracted without a configured vision model.",
      ];
    }

    return {
      result: {
        observationId: input.observationId,
        detectedObjects,
        attributes,
        limitations,
        processedAt: new Date().toISOString(),
        model: this.model,
      },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        estimatedUsd: 0,
        latencyMs: Date.now() - startedAt,
      },
    };
  }
}

export function createVisionProvider(): VisionPerceptionProvider {
  if (process.env.OPENAI_API_KEY) return new OpenAIVisionProvider();
  if (
    process.env.VISION_FIXTURE_MODE === "true" ||
    process.env.NODE_ENV === "test" ||
    !process.env.OPENAI_API_KEY
  ) {
    return new FixtureVisionProvider();
  }
  return new OpenAIVisionProvider();
}

export class OpenAIVisionProvider implements VisionPerceptionProvider {
  readonly name = "openai";
  readonly model =
    process.env.OPENAI_VISION_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  async analyze(input: VisionAnalysisInput): Promise<VisionAnalysis> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new VisionError(
        "Vision analysis is not configured.",
        "vision_not_configured",
      );
    }
    const startedAt = Date.now();
    const endpoint = `${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`;
    let response: Response | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            max_tokens: Number(process.env.OPENAI_VISION_MAX_OUTPUT_TOKENS ?? 800),
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: modelPrompt() },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Extract only attributes supported by this authorized image.",
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${input.mediaType};base64,${input.dataBase64}`,
                      detail: process.env.OPENAI_VISION_DETAIL ?? "low",
                    },
                  },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(
            Number(process.env.OPENAI_VISION_TIMEOUT_MS ?? 30_000),
          ),
        });
        if (response.ok) break;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable) {
          throw new VisionError(
            `Vision provider rejected the request (${response.status}).`,
            "vision_provider_error",
          );
        }
        lastError = new Error(`Vision provider returned ${response.status}`);
        response = null;
      } catch (error) {
        if (error instanceof VisionError && !error.retryable) throw error;
        lastError = error;
        response = null;
      }
      if (attempt === 0) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Number(process.env.OPENAI_VISION_RETRY_BASE_MS ?? 400),
          ),
        );
      }
    }
    if (!response) {
      throw new VisionError(
        lastError instanceof Error
          ? `Vision provider unavailable: ${lastError.message}`
          : "Vision provider unavailable.",
        "vision_provider_error",
        true,
      );
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new VisionError(
        "Vision provider returned no structured result.",
        "malformed_model_response",
      );
    }
    const result = parsePerceptionResult(
      content,
      input.observationId,
      this.model,
    );
    if (!result) {
      throw new VisionError(
        "Vision provider returned malformed or unsupported attributes.",
        "malformed_model_response",
      );
    }
    const inputTokens = Math.max(0, payload.usage?.prompt_tokens ?? 0);
    const outputTokens = Math.max(0, payload.usage?.completion_tokens ?? 0);
    const inputRate = Number(
      process.env.OPENAI_VISION_INPUT_USD_PER_MILLION ?? 0.15,
    );
    const outputRate = Number(
      process.env.OPENAI_VISION_OUTPUT_USD_PER_MILLION ?? 0.6,
    );
    return {
      result,
      usage: {
        inputTokens,
        outputTokens,
        estimatedUsd: Number(
          (
            (inputTokens * inputRate + outputTokens * outputRate) /
            1_000_000
          ).toFixed(6),
        ),
        latencyMs: Date.now() - startedAt,
      },
    };
  }
}
