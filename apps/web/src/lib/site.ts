import type { Metadata } from "next";
import { FREE_DAILY_REQUESTS } from "@nearby/shared";

export const SITE_URL = "https://www.nearbyhello.com";
export const SITE_NAME = "Nearby Hello";
export const SITE_TITLE = "Nearby Hello: know what a place is like before you walk in";
export const SITE_DESCRIPTION =
  "See whether a nearby place feels calm or lively, what changed, and what is normal for that time.";
export const SITE_TAGLINE = "See more than a map can tell you.";
export const CONNECTOR_PRIVACY_LINE =
  "Nearby Hello only collects a sensor category after explicit permission. You can stop collection or delete eligible observations anytime.";

export const PRICING_FAQ = [
  {
    q: "What is included in the Free tier?",
    a: `Free includes ${FREE_DAILY_REQUESTS} requests a day. A reschedule and an email draft each count as one request. Messages with your connections are free, along with calendar, tasks, mail, and notes.`,
  },
  {
    q: "How much is Pro?",
    a: "Pro is $29 a month or $249 a year, with a 7-day free trial. Use FOUNDING19 for $19 a month for life. A card is required for the trial. Cancel anytime.",
  },
  {
    q: "What does Pro include?",
    a: "Pro includes unlimited requests for days packed with calls, plus voice memo recaps that turn a long call into follow-ups.",
  },
  {
    q: "Does Nearby send emails on its own?",
    a: "No. Nearby drafts replies for you to review, and it never sends without your OK.",
  },
  {
    q: "Which Google apps does Nearby work with?",
    a: "Nearby works with Google Calendar, Gmail, and Google Tasks.",
  },
] as const;

const PRIVATE_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/activity",
  "/explore",
  "/patterns",
  "/profile",
  "/connectors",
  "/onboarding",
  "/nearby",
  "/connections",
  "/messages",
  "/app",
];

export const PRIVATE_ROBOTS_PATHS = PRIVATE_PATHS;

export function privateMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false },
  };
}

export function siteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/favicon.svg`,
        description: SITE_DESCRIPTION,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        inLanguage: "en",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#app`,
        name: SITE_NAME,
        url: SITE_URL,
        applicationCategory: "LifestyleApplication",
        operatingSystem: "Web",
        description: SITE_DESCRIPTION,
        featureList: [
          "Foreground location-based environmental context",
          "Local digital loudness processing without saved audio",
          "Participating-device motion intensity",
          "Historical spatial patterns",
          "Privacy-thresholded community aggregates",
        ],
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };
}

export function llmsText() {
  return `# Nearby Hello

> ${SITE_DESCRIPTION}

Nearby Hello helps people understand nearby physical spaces using supported,
permission-based smartphone measurements and historical spatial patterns.

## Canonical

- Site: ${SITE_URL}
- Name: Nearby Hello
- Domain: nearbyhello.com
- Language: English
- Category: hyperlocal spatial intelligence

## What it does

- Shows approximate location and privacy-preserving spatial zones.
- Measures digital ambient loudness locally without storing raw audio.
- Measures motion intensity of participating devices only.
- Builds historical patterns after enough measurements exist.
- Distinguishes measured, estimated, historical, example, and
  unavailable information.

## Privacy and control

- Sensor permissions are explicit and granular.
- Each spot reading is foreground-only and stops automatically.
- Community aggregates require minimum contributor thresholds.
- Nearby Hello does not expose individual movement histories.
- Users can explore without contributing and delete eligible observations.

## Pages

- [Home](${SITE_URL}/): Product overview
- [Sign up](${SITE_URL}/signup): Create a Nearby Hello account

## Machine-readable

- [Sitemap](${SITE_URL}/sitemap.xml)
- [Favicon](${SITE_URL}/favicon.svg)
`;
}
