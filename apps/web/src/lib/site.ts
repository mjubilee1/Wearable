import type { Metadata } from "next";

export const SITE_URL = "https://www.nearbyhello.com";
export const SITE_NAME = "Nearby";
export const SITE_TITLE = "Nearby: voice assistant for busy professionals";
export const SITE_DESCRIPTION =
  "Your voice assistant for busy days. Talk to Nearby, and it handles your calendar, follow-ups, and emails.";
export const SITE_TAGLINE = "Speak, and it answers out loud.";
export const CONNECTOR_PRIVACY_LINE =
  "Nearby only uses a connector when you ask. You can disconnect anytime.";

export const PRICING_FAQ = [
  {
    q: "What is included in the Free tier?",
    a: "Free includes 20 requests a day, 3 reschedules a day, 3 email drafts a day, and access to calendar, tasks, mail, and notes.",
  },
  {
    q: "How much is Pro?",
    a: "Pro is $29 a month or $249 a year, with a 7-day free trial. Cancel anytime.",
  },
  {
    q: "What does Pro include?",
    a: "Pro includes unlimited requests, unlimited reschedules and drafts, and voice memo recaps that turn into follow-ups.",
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
            name: "Pro",
            price: "29",
            priceCurrency: "USD",
            url: `${SITE_URL}/pricing`,
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: "29",
              priceCurrency: "USD",
              unitText: "MONTH",
            },
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

Nearby is a voice and type assistant for busy professionals who live on calls, including recruiters, sales reps, consultants, and real estate agents. Use it from a laptop, phone, or headphones to handle calendar changes, follow-ups, and email drafts throughout the day. The pendant is coming soon.

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

## Plans

- Free: 20 requests per day.
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
