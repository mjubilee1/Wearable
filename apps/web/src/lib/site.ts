import type { Metadata } from "next";
import { FREE_DAILY_REQUESTS } from "@nearby/shared";

export const SITE_URL = "https://www.nearbyhello.com";
export const SITE_NAME = "Nearby Hello";
export const SITE_TITLE = "Nearby Hello: understand the space around you";
export const SITE_DESCRIPTION =
  "Privacy-first hyperlocal spatial intelligence from permission-based environmental measurements and historical patterns.";
export const SITE_TAGLINE = "Make the physical world understandable, one location at a time.";
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
          "Local relative sound-intensity processing",
          "Participating-device movement states",
          "Historical spatial patterns",
          "Privacy-thresholded community aggregates",
        ],
        offers: [
          {
            "@type": "Offer",
            name: "Free",
            price: "0",
            priceCurrency: "USD",
            url: `${SITE_URL}/pricing`,
          },
          {
            "@type": "Offer",
            name: "Pro monthly",
            price: "29",
            priceCurrency: "USD",
            url: `${SITE_URL}/pricing`,
          },
        ],
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE_URL}/#faq`,
        url: `${SITE_URL}/#questions`,
        mainEntity: PRICING_FAQ.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.a,
          },
        })),
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
- Measures relative ambient sound locally without storing raw audio.
- Classifies broad movement of participating devices only.
- Builds historical patterns after enough measurements exist.
- Distinguishes measured, estimated, historical, demonstration, and
  unavailable information.

## Privacy and control

- Sensor permissions are explicit and granular.
- Collection is foreground-only by default and has visible stop controls.
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
