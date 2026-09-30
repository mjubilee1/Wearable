import {
  mockFacilitate,
  type FacilitateResponse,
  type UserProfile,
} from "@nearby/shared";

function profileBrief(profile: UserProfile): string {
  return JSON.stringify(
    {
      name: profile.name,
      role: profile.role,
      interests: profile.interests,
      bio: profile.bio || undefined,
      lookingFor: profile.lookingFor || undefined,
      vibes: profile.vibes?.length ? profile.vibes : undefined,
      prompts: profile.prompts?.length ? profile.prompts : undefined,
    },
    null,
    2,
  );
}

export async function facilitateMatch(
  self: UserProfile,
  other: UserProfile,
): Promise<FacilitateResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  if (!apiKey) {
    return mockFacilitate(self, other);
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You help strangers who just walked near each other start a natural conversation. Use only the provided profile fields. Never invent facts. Return JSON: { \"whyYouVibe\": string, \"icebreakers\": string[3] }. Keep tone warm, short, non-creepy.",
          },
          {
            role: "user",
            content: `Self profile:\n${profileBrief(self)}\n\nOther profile:\n${profileBrief(other)}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error("facilitate LLM error", await res.text());
      return mockFacilitate(self, other);
    }

    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return mockFacilitate(self, other);

    const parsed = JSON.parse(content) as {
      whyYouVibe?: string;
      icebreakers?: string[];
    };

    const icebreakers = Array.isArray(parsed.icebreakers)
      ? parsed.icebreakers.map(String).filter(Boolean).slice(0, 3)
      : [];

    if (!parsed.whyYouVibe || icebreakers.length === 0) {
      return mockFacilitate(self, other);
    }

    while (icebreakers.length < 3) {
      icebreakers.push(`What's something fun you'd try nearby this week?`);
    }

    return {
      whyYouVibe: String(parsed.whyYouVibe),
      icebreakers,
      mode: "llm",
    };
  } catch (error) {
    console.error("facilitate failed", error);
    return mockFacilitate(self, other);
  }
}
