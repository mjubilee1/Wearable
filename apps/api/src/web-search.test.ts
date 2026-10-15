import assert from "node:assert/strict";
import test from "node:test";
import { isAgentToolName } from "@nearby/shared";
import { runAgentTurn, WEB_SEARCH_GUIDANCE } from "./agent.js";
import { answerWithWebSearch, SEARCH_UNAVAILABLE } from "./web-search.js";

const WEATHER = "what's the weather in Washington DC today";
const SOURCED =
  "It's 68 degrees and cloudy in Washington DC today, according to weather.gov.";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("web search tool", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSearch = process.env.SEARCH_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalSearch === undefined) delete process.env.SEARCH_API_KEY;
    else process.env.SEARCH_API_KEY = originalSearch;
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAI;
  });

  await t.test("web_search is a model tool and stays off account requests", () => {
    assert.equal(isAgentToolName("web_search"), true);
    assert.match(WEB_SEARCH_GUIDANCE, /web_search/);
    assert.match(
      WEB_SEARCH_GUIDANCE,
      /Do not use web_search for calendar, email, tasks, notes, reminders, or memories/,
    );
    assert.match(WEB_SEARCH_GUIDANCE, /cannot log in, click, buy, or submit a form/);
  });

  await t.test("weather in Washington DC returns a sourced answer", async () => {
    process.env.SEARCH_API_KEY = "test-search-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    const urls: string[] = [];
    let tavilyQuery = "";
    let summaryPrompt = "";
    let chatCalls = 0;

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("api.tavily.com/search")) {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), "Bearer test-search-key");
        const body = JSON.parse(String(init?.body)) as {
          query?: string;
          max_results?: number;
        };
        assert.equal(JSON.stringify(body).includes("test-search-key"), false);
        assert.equal(body.max_results, 5);
        tavilyQuery = body.query ?? "";
        return jsonResponse({
          results: [
            {
              title: "Washington, DC forecast",
              url: "https://www.weather.gov/",
              content: "Washington DC is 68 degrees and cloudy this afternoon.",
            },
            {
              title: "Hourly weather",
              url: "https://forecast.weather.gov/MapClick.php?lat=38.9&lon=-77.0",
              content: "This afternoon: cloudy, around 68 degrees.",
            },
            {
              title: "DC conditions",
              url: "https://www.weather.gov/lwx/",
              content: "Current conditions in Washington DC are cloudy.",
            },
          ],
        });
      }
      if (url.includes("/chat/completions")) {
        chatCalls += 1;
        const body = JSON.parse(String(init?.body)) as {
          messages?: Array<{ role?: string; content?: string }>;
        };
        const joined = (body.messages ?? []).map((message) => message.content ?? "").join("\n");
        if (chatCalls === 1) {
          assert.match(joined, /web_search/);
          assert.match(joined, /Do not use web_search for calendar/);
          return jsonResponse({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    reply: "Let me look that up.",
                    tool: {
                      name: "web_search",
                      summary: "Washington DC weather today",
                      payload: { query: "Washington DC weather today" },
                    },
                  }),
                },
              },
            ],
          });
        }
        summaryPrompt = joined;
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({ reply: SOURCED }),
              },
            },
          ],
        });
      }
      if (url.includes("/embeddings")) {
        return jsonResponse({ data: [{ embedding: [1, 0] }] });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const response = await runAgentTurn("web-search-weather", {
      text: WEATHER,
      timeZone: "America/New_York",
    });

    assert.equal(tavilyQuery, "Washington DC weather today");
    assert.match(summaryPrompt, new RegExp(WEATHER, "i"));
    assert.match(summaryPrompt, /68 degrees/);
    assert.match(summaryPrompt, /weather\.gov/);
    assert.equal(response.reply, SOURCED);
    assert.match(response.reply, /weather\.gov/);
    assert.doesNotMatch(response.reply, /couldn't search/i);
    const sentences = response.reply.split(/(?<=[.!?])\s+(?=[A-Z])/);
    assert.ok(sentences.length >= 1 && sentences.length <= 3);
    assert.equal(response.receipt?.linkLabel, "weather.gov");
    assert.equal(response.receipt?.href, "https://www.weather.gov/");
    assert.equal(urls.some((url) => url.includes("weather.gov")), false);
    assert.equal(urls.filter((url) => url.includes("api.tavily.com")).length, 1);
  });

  await t.test("search failure says to try again", async () => {
    process.env.SEARCH_API_KEY = "test-search-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("api.tavily.com/search")) {
        return jsonResponse({ error: "unavailable" }, 503);
      }
      if (url.includes("/chat/completions")) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reply: "Let me look that up.",
                  tool: {
                    name: "web_search",
                    summary: "Washington DC weather today",
                    payload: { query: "Washington DC weather today" },
                  },
                }),
              },
            },
          ],
        });
      }
      if (url.includes("/embeddings")) {
        return jsonResponse({ data: [{ embedding: [1, 0] }] });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const response = await runAgentTurn("web-search-error", {
      text: WEATHER,
      timeZone: "America/New_York",
    });
    assert.equal(response.reply, SEARCH_UNAVAILABLE);
    assert.equal(urls.filter((url) => url.includes("/chat/completions")).length, 1);
  });

  await t.test("calendar requests do not search the web", async () => {
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/embeddings")) {
        return jsonResponse({ data: [{ embedding: [1, 0] }] });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const response = await runAgentTurn("web-search-calendar", {
      text: "what's on my calendar today",
      timeZone: "America/New_York",
    });
    assert.equal(urls.some((url) => url.includes("tavily.com")), false);
    assert.match(response.reply, /calendar/i);
    assert.doesNotMatch(response.reply, /couldn't search/i);
  });

  await t.test("missing search key does not throw", async () => {
    delete process.env.SEARCH_API_KEY;
    const answer = await answerWithWebSearch({
      question: WEATHER,
      query: "Washington DC weather today",
      name: null,
    });
    assert.equal(answer.reply, SEARCH_UNAVAILABLE);
    assert.equal(answer.receipt, null);
  });
});
