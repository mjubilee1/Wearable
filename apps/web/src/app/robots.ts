import type { MetadataRoute } from "next";
import { PRIVATE_ROBOTS_PATHS, SITE_URL } from "@/lib/site";

const AI_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
];

export default function robots(): MetadataRoute.Robots {
  const publicPages = { allow: "/", disallow: PRIVATE_ROBOTS_PATHS };
  return {
    rules: [
      { userAgent: "*", ...publicPages },
      { userAgent: AI_AGENTS, ...publicPages },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
