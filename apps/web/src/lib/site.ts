import type { Metadata } from "next";

export const SITE_URL = "https://www.nearbyhello.com";
export const SITE_NAME = "Nearby";
export const SITE_TITLE = "Nearby — Voice assistant that answers out loud";
export const SITE_DESCRIPTION =
  "Voice assistant for your day. Speak from a laptop or headphones about calendar, notes, and reminders, and get a short answer out loud.";
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
  const faq = QUESTIONS.map((item) => `### ${item.q}\n${item.a}`).join("\n\n");
  return `# Nearby

> ${SITE_DESCRIPTION} Canonical site: ${SITE_URL}

Nearby (nearbyhello.com) is a voice assistant. You speak from a laptop, phone, or headphones. It handles calendar, notes, and reminders when you ask, then answers out loud and stops. It is an early proof of concept and is not for sale. Nearby does not record the room. It is not a social network, a location-sharing app, or a chat companion.

## Canonical

- Site: ${SITE_URL}
- Name: Nearby
- Domain: nearbyhello.com
- Language: English
- Category: voice assistant

## What it does

- You speak. Nearby handles the task. It answers out loud, then stops.
- Jobs: calendar, notes, and reminders.
- Where you can talk: a laptop, a phone, or headphones.
- A spoken request runs the tool. A saved fact can be deleted.

## What it does not do

- It does not quietly record the room.
- It does not ship a gadget for a job the phone already does better.
- It is not a companion that chats for company.
- No device is for sale yet.

## Pages

- [Home](${SITE_URL}/): Product explanation and a waitlist for updates
- [How it works](${SITE_URL}/#how): Speak, the task runs, then a short spoken answer
- [The day](${SITE_URL}/#day): Morning agenda, work capture, and hands-free on the move
- [What we refuse](${SITE_URL}/#refuse): Not a phone in a box, not a companion, not a recorder
- [Questions](${SITE_URL}/#questions): What Nearby does, recording, devices, and memory

## Questions

${faq}

## Machine-readable

- [Sitemap](${SITE_URL}/sitemap.xml)
- [Favicon](${SITE_URL}/favicon.svg)
`;
}
