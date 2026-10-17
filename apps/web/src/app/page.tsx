// PARITY: mobile — marketing landing and pricing are web-only.
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDemo } from "@/components/CalendarDemo";
import { LandingView } from "@/components/LandingView";
import { HomepageLiveDemo } from "@/components/HomepageLiveDemo";
import { NecklaceMessages } from "@/components/NecklaceMessages";
import { MarketingNav } from "@/components/MarketingNav";
import { PricingSection } from "@/components/PricingSection";
import { WaitlistForm } from "@/components/WaitlistForm";
import { Testimonials } from "@/components/Testimonials";
import {
  CONNECTOR_PRIVACY_LINE,
  SITE_DESCRIPTION,
  SITE_TITLE,
  siteJsonLd,
} from "@/lib/site";

const AUDIENCES = {
  general: {
    builtFor: "Built for recruiters, sales reps, and consultants.",
    subhead:
      "Your voice assistant for busy days. Talk to it, and it handles your calendar, follow-ups, and emails.",
    examples: [
      { title: "Move a call", body: "Move my 2 PM call to tomorrow at 10." },
      {
        title: "Draft a follow-up",
        body: "Draft a follow-up to Sarah about the proposal.",
      },
      {
        title: "Set a reminder",
        body: "Remind me to send the candidate feedback Friday.",
      },
      {
        title: "Check the day",
        body: "What's on my calendar before my 4 PM meeting?",
      },
    ],
    demo: {
      request: "Move my 2 PM call to tomorrow at 10.",
      receipt: "Moved 2 PM call to tomorrow at 10:00 AM",
    },
  },
  recruiters: {
    builtFor: "Built for recruiters.",
    subhead:
      "Your voice assistant for packed interview days. Talk to it, and it handles your calendar, candidate follow-ups, and emails.",
    examples: [
      {
        title: "Move an interview",
        body: "Move my 2 PM candidate call to tomorrow at 10.",
      },
      {
        title: "Draft a follow-up",
        body: "Draft a follow-up to Sarah about the product role.",
      },
      {
        title: "Set a reminder",
        body: "Remind me to send the candidate feedback Friday.",
      },
      {
        title: "Check the day",
        body: "What's on my calendar before my 4 PM interview?",
      },
    ],
    demo: {
      request: "Move my 2 PM candidate call to tomorrow at 10.",
      receipt: "Moved 2 PM candidate call to tomorrow at 10:00 AM",
    },
  },
  sales: {
    builtFor: "Built for sales reps.",
    subhead:
      "Your voice assistant for back-to-back sales calls. Talk to it, and it handles your calendar, follow-ups, and emails.",
    examples: [
      {
        title: "Move a demo",
        body: "Move my 2 PM prospect call to tomorrow at 10.",
      },
      {
        title: "Draft a follow-up",
        body: "Draft a follow-up to Sarah about the proposal.",
      },
      {
        title: "Set a reminder",
        body: "Remind me to send the pricing recap Friday.",
      },
      {
        title: "Check the day",
        body: "What's on my calendar before my 4 PM demo?",
      },
    ],
    demo: {
      request: "Move my 2 PM prospect call to tomorrow at 10.",
      receipt: "Moved 2 PM prospect call to tomorrow at 10:00 AM",
    },
  },
  consultants: {
    builtFor: "Built for consultants.",
    subhead:
      "Your voice assistant for client-heavy days. Talk to it, and it handles your calendar, follow-ups, and emails.",
    examples: [
      {
        title: "Move a client call",
        body: "Move my 2 PM client call to tomorrow at 10.",
      },
      {
        title: "Draft a follow-up",
        body: "Draft a follow-up to Sarah about the proposal.",
      },
      {
        title: "Set a reminder",
        body: "Remind me to send the workshop notes Friday.",
      },
      {
        title: "Check the day",
        body: "What's on my calendar before my 4 PM meeting?",
      },
    ],
    demo: {
      request: "Move my 2 PM client call to tomorrow at 10.",
      receipt: "Moved 2 PM client call to tomorrow at 10:00 AM",
    },
  },
  managers: {
    builtFor: "Built for managers.",
    subhead:
      "Your voice assistant for meeting-heavy days. Talk to it, and it handles your calendar, team follow-ups, and emails.",
    examples: [
      {
        title: "Move a meeting",
        body: "Move my 2 PM team meeting to tomorrow at 10.",
      },
      {
        title: "Draft a follow-up",
        body: "Draft a follow-up to Sarah about the project.",
      },
      {
        title: "Set a reminder",
        body: "Remind me to send the team recap Friday.",
      },
      {
        title: "Check the day",
        body: "What's on my calendar before my 4 PM meeting?",
      },
    ],
    demo: {
      request: "Move my 2 PM team meeting to tomorrow at 10.",
      receipt: "Moved 2 PM team meeting to tomorrow at 10:00 AM",
    },
  },
  realestate: {
    builtFor: "Built for real estate agents.",
    subhead:
      "Your voice assistant between showings. Talk to it, and it handles your calendar, follow-ups, and emails.",
    examples: [
      {
        title: "Move a showing",
        body: "Move my 2 PM showing to tomorrow at 10.",
      },
      {
        title: "Draft a follow-up",
        body: "Draft a follow-up to Sarah about the offer.",
      },
      {
        title: "Set a reminder",
        body: "Remind me to send the inspection notes Friday.",
      },
      {
        title: "Check the day",
        body: "What's on my calendar before my 4 PM closing?",
      },
    ],
    demo: {
      request: "Move my 2 PM showing to tomorrow at 10.",
      receipt: "Moved 2 PM showing to tomorrow at 10:00 AM",
    },
  },
} as const;

type AudienceKey = keyof typeof AUDIENCES;

const AUDIENCE_ALIASES: Record<string, AudienceKey> = {
  general: "general",
  recruiter: "recruiters",
  recruiters: "recruiters",
  consultant: "consultants",
  consultants: "consultants",
  sale: "sales",
  sales: "sales",
  manager: "managers",
  managers: "managers",
  realtor: "realestate",
  realtors: "realestate",
  agent: "realestate",
  agents: "realestate",
  realestate: "realestate",
  "real-estate": "realestate",
};

function audienceFrom(value: string | string[] | undefined): AudienceKey {
  const key = Array.isArray(value) ? value[0] : value;
  return key ? (AUDIENCE_ALIASES[key.toLowerCase()] ?? "general") : "general";
}

type HomeSearchParams = Promise<{ for?: string | string[] }>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: HomeSearchParams;
}): Promise<Metadata> {
  const audienceKey = audienceFrom((await searchParams).for);
  const audience = AUDIENCES[audienceKey];
  const title = audienceKey === "general" ? SITE_TITLE : audience.builtFor;
  const description =
    audienceKey === "general" ? SITE_DESCRIPTION : audience.subhead;

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: "/",
      types: { "text/plain": "/llms.txt" },
    },
    openGraph: {
      url: "/",
      title,
      description,
    },
    twitter: {
      title,
      description,
    },
  };
}

const PROFESSIONS = ["Recruiters", "Sales reps", "Consultants", "Real estate agents"];

export default async function HomePage({
  searchParams,
}: {
  searchParams: HomeSearchParams;
}) {
  const audience = AUDIENCES[audienceFrom((await searchParams).for)];
  return (
    <div id="top" className="min-h-dvh text-ink">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }}
      />
      <LandingView />
      <MarketingNav />
      <main>
        <section className="mx-auto grid max-w-5xl items-end gap-10 px-5 pb-16 pt-12 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:pt-16">
          <div>
            <h1 className="font-display max-w-[8ch] text-6xl font-medium leading-[0.9] text-ink sm:text-8xl">
              Talk. It does it.
            </h1>
            <p className="mt-6 max-w-sm text-lg leading-snug text-ink">
              {audience.subhead}
            </p>
            <p className="mt-3 text-sm text-muted">{audience.builtFor}</p>
            <Link
              href="/signup"
              className="mt-8 inline-flex bg-ink px-5 py-3 text-sm font-semibold text-white"
            >
              Start free
            </Link>
          </div>
          <CalendarDemo
            request={audience.demo.request}
            receipt={audience.demo.receipt}
          />
        </section>

        <NecklaceMessages />

        <HomepageLiveDemo />

        <section className="px-5 pb-16" aria-label="Example requests">
          <ol className="mx-auto max-w-5xl border-t border-ink/15">
            {audience.examples.map((task, index) => (
              <li
                key={task.title}
                className="grid gap-1 border-b border-ink/15 py-5 sm:grid-cols-[3.5rem_11rem_1fr] sm:items-baseline sm:gap-6"
              >
                <span className="font-display text-lg text-teal">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="text-sm font-semibold text-ink">{task.title}</p>
                <p className="font-display text-xl italic leading-snug text-ink">
                  “{task.body}”
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="px-5 pb-20" aria-labelledby="calls-heading">
          <div className="mx-auto max-w-5xl border-t border-ink/15 pt-8">
            <h2 id="calls-heading" className="text-sm text-muted">
              Built for people who live on calls
            </h2>
            <p className="font-display mt-3 max-w-2xl text-3xl font-medium leading-tight text-ink sm:text-4xl">
              {`${PROFESSIONS.join(", ")}.`}
            </p>
          </div>
        </section>

        <Testimonials />

        <section id="pricing" className="scroll-mt-16 px-5 pb-20">
          <div className="mx-auto max-w-5xl">
            <PricingSection />
            <p className="mt-4 text-sm text-muted">
              <Link href="/pricing" className="text-ink underline decoration-teal decoration-2 underline-offset-4">
                Pricing details
              </Link>
            </p>
          </div>
        </section>
      </main>
      <footer className="border-t border-ink/15 px-5 py-12">
        <div className="mx-auto flex max-w-5xl flex-col gap-8 sm:flex-row sm:justify-between">
          <div>
            <p className="font-display text-3xl italic text-ink">nearby</p>
            <p className="mt-2 max-w-xs text-sm text-muted">Talk. It does it.</p>
          </div>
          <div className="flex gap-10 text-sm">
            <div className="flex flex-col gap-2">
              <a href="#messages" className="text-muted hover:text-ink">
                Messages
              </a>
              <a href="#pricing" className="text-muted hover:text-ink">
                Pricing
              </a>
              <Link href="/pricing" className="text-muted hover:text-ink">
                FAQ
              </Link>
              <Link href="/signup" className="text-muted hover:text-ink">
                Start free
              </Link>
            </div>
            <div className="flex flex-col gap-2">
              <Link href="/login" className="text-muted hover:text-ink">
                Sign in
              </Link>
            </div>
          </div>
        </div>
        <div id="waitlist" className="mx-auto mt-10 max-w-md">
          <p className="mb-3 text-sm text-muted">Get updates</p>
          <WaitlistForm />
        </div>
        <p className="mx-auto mt-10 max-w-5xl text-xs leading-relaxed text-muted">
          {CONNECTOR_PRIVACY_LINE} Nearby does not record the room.
        </p>
      </footer>
    </div>
  );
}
