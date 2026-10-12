import type { Metadata } from "next";

export const SITE_URL = "https://www.nearbyhello.com";
export const SITE_NAME = "Nearby";
export const SITE_TITLE = "Nearby: your voice assistant between showings";
export const SITE_DESCRIPTION =
  "Talk to Nearby between showings. It moves your calendar, sets follow-ups, and drafts emails to lenders and clients. Pro $29/mo with a 7-day free trial.";
export const SITE_TAGLINE = "Speak, and it answers out loud.";
export const CONNECTOR_PRIVACY_LINE =
  "Nearby only uses a connector when you ask. You can disconnect anytime.";

export const QUESTIONS = [
  {
    q: "What does Nearby do?",
    a: "You speak, it handles the task, and it answers out loud. The jobs it’s for are the ones that interrupt a day: calendar, notes, and reminders.",
  },
  {
    q: "Does it record the room?",
    a: "No. Nearby does not quietly capture what’s around you. It acts when you ask, then stops.",
  },
  {
    q: "Can I buy a device?",
    a: "Not yet. This is an early proof of concept. The loop runs on a laptop or headphones first. A wearable comes after that loop is worth using every day.",
  },
  {
    q: "What does it remember?",
    a: "A fact you asked it to remember. A conversation is not stored just because it happened near you. You can delete a saved fact.",
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
          "Calendar, notes, and reminders",
          "Laptop, phone, or headphones",
          "A spoken request runs the tool",
          "A saved fact can be deleted",
        ],
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE_URL}/#faq`,
        url: `${SITE_URL}/#questions`,
        mainEntity: QUESTIONS.map((item) => ({
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

Nearby is a paid voice and type assistant for real estate agents and busy professionals. Use it from a laptop, phone, or headphones to handle work between showings. The pendant is coming soon.

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
