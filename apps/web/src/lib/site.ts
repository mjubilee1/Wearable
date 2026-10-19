import type { Metadata } from "next";
import { FREE_DAILY_REQUESTS } from "@nearby/shared";

export const SITE_URL = "https://www.nearbyhello.com";
export const SITE_NAME = "Nearby";
export const SITE_TITLE = "Nearby: finish the follow-up before the next call";
export const SITE_DESCRIPTION =
  "Say what happened. Nearby drafts the email, puts the time on Google Calendar, and saves the task in Google Tasks — in the accounts you already use.";
export const SITE_TAGLINE = "Speak, and it answers out loud.";
export const CONNECTOR_PRIVACY_LINE =
  "Nearby only uses a connector when you ask. You can disconnect anytime.";

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
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Web",
        description: SITE_DESCRIPTION,
        featureList: [
          "Spoken questions and short spoken answers",
          "Google Calendar, Gmail, and Google Tasks",
          "Laptop, phone, or headphones",
          "Email drafts are sent only with your approval",
          "Voice memo recaps that turn into follow-ups",
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
  return `# Nearby

> ${SITE_DESCRIPTION}

Nearby helps recruiters, sales reps, consultants, and real estate agents handle the work between calls. Talk or type from a laptop, phone, or headphones to make calendar changes, capture follow-ups, and draft emails throughout the day. The pendant is coming soon.

## Canonical

- Site: ${SITE_URL}
- Name: Nearby
- Domain: nearbyhello.com
- Language: English
- Category: voice and type assistant

## What it does

- Works with Google Calendar, Google Tasks, Gmail, and Notes.
- Reschedules calendar events with a confirmation step before making the change.
- Adds tasks and follow-ups.
- Summarizes unread email.
- Drafts replies for you to review and approve. Nearby never sends email on its own.
- Saves notes.
- Accepts voice or typed requests and can answer out loud.
- Messages someone from the necklace. The thread is a normal chat with people you know. Nearby does not send carrier SMS.

## Plans

- Free: ${FREE_DAILY_REQUESTS} requests per day. Reschedules and email drafts count as requests. Messages are free.
- Pro: $29 per month or $249 per year, with a 7-day free trial.

## Privacy and control

- Nearby does not record the room.
- Nearby acts when you ask, then stops.
- Email drafts require your approval. Nearby never sends them on its own.
- Connector access can be disconnected at any time.

## Pages

- [Home](${SITE_URL}/): Product overview
- [Pricing](${SITE_URL}/pricing): Free and Pro plan details
- [Sign up](${SITE_URL}/signup): Create a Nearby account

## Machine-readable

- [Sitemap](${SITE_URL}/sitemap.xml)
- [Favicon](${SITE_URL}/favicon.svg)
`;
}
