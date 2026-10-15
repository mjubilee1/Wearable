// PARITY: mobile — marketing landing and pricing are web-only.
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDemo } from "@/components/CalendarDemo";
import { LandingView } from "@/components/LandingView";
import { HomepageLiveDemo } from "@/components/HomepageLiveDemo";
import { MarketingAccountLink } from "@/components/MarketingAccountLink";
import { MarketingNav } from "@/components/MarketingNav";
import { PricingSection } from "@/components/PricingSection";
import { WaitlistForm } from "@/components/WaitlistForm";
import { Testimonials } from "@/components/Testimonials";
import { CONNECTOR_PRIVACY_LINE, siteJsonLd } from "@/lib/site";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    types: { "text/plain": "/llms.txt" },
  },
};

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
  agents: {
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
  manager: "sales",
  managers: "sales",
  realtor: "agents",
  realtors: "agents",
  agent: "agents",
  agents: "agents",
  realestate: "agents",
  "real-estate": "agents",
};

function audienceFrom(value: string | string[] | undefined): AudienceKey {
  const key = Array.isArray(value) ? value[0] : value;
  return key ? (AUDIENCE_ALIASES[key.toLowerCase()] ?? "general") : "general";
}

const PROFESSIONS = ["Recruiters", "Sales reps", "Consultants", "Real estate agents"];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string | string[] }>;
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
        <section className="px-5 pb-8 pt-16 text-center sm:pt-24">
          <p className="text-sm font-semibold text-teal">Nearby</p>
          <h1 className="mx-auto mt-4 max-w-3xl text-5xl font-bold leading-[1.02] tracking-[-0.04em] sm:text-7xl">
            Talk. It does it.
          </h1>
          <p className="mx-auto mt-5 max-w-md text-base text-muted sm:text-lg">
            {audience.subhead}
          </p>
          <p className="mt-4 text-sm font-semibold text-ink/75">
            {audience.builtFor}
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-flex rounded-full bg-teal px-6 py-3 text-sm font-semibold text-white"
          >
            Start free
          </Link>
        </section>

        <HomepageLiveDemo />

        <section className="px-5 pb-16" aria-label="Calendar request demo">
          <CalendarDemo
            request={audience.demo.request}
            receipt={audience.demo.receipt}
          />
        </section>

        <section className="px-5 pb-16">
          <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2">
            {audience.examples.map((task) => (
              <div
                key={task.title}
                className="rounded-[28px] bg-white p-5 ring-1 ring-black/5"
              >
                <p className="text-sm font-semibold text-ink">{task.title}</p>
                <p className="mt-2 text-sm text-muted">“{task.body}”</p>
              </div>
            ))}
          </div>
        </section>

        <section className="px-5 pb-20" aria-labelledby="calls-heading">
          <div className="mx-auto max-w-4xl rounded-[28px] bg-teal-soft/60 px-6 py-7 text-center ring-1 ring-teal/20">
            <h2 id="calls-heading" className="text-xl font-bold tracking-tight text-ink">
              Built for people who live on calls
            </h2>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {PROFESSIONS.map((profession) => (
                <span
                  key={profession}
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink ring-1 ring-black/5"
                >
                  {profession}
                </span>
              ))}
            </div>
          </div>
        </section>

        <Testimonials />

        <section id="pricing" className="scroll-mt-16 px-5 pb-20">
          <div className="mx-auto max-w-4xl">
            <PricingSection />
            <p className="mt-4 text-center text-sm text-muted">
              <Link href="/pricing" className="font-semibold text-teal">
                Pricing details
              </Link>
            </p>
          </div>
        </section>
      </main>
      <footer className="border-t border-black/10 px-5 py-12">
        <div className="mx-auto flex max-w-4xl flex-col gap-8 sm:flex-row sm:justify-between">
          <div>
            <p className="text-2xl font-extrabold tracking-[-0.04em] text-teal">
              nearby
            </p>
            <p className="mt-2 max-w-xs text-sm text-muted">Talk. It does it.</p>
          </div>
          <div className="flex gap-10 text-sm">
            <div className="flex flex-col gap-2">
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
              <MarketingAccountLink className="text-muted hover:text-ink" />
            </div>
          </div>
        </div>
        <div id="waitlist" className="mx-auto mt-10 max-w-md">
          <p className="mb-3 text-sm text-muted">Get updates</p>
          <WaitlistForm />
        </div>
        <p className="mx-auto mt-10 max-w-4xl text-xs leading-relaxed text-muted">
          {CONNECTOR_PRIVACY_LINE} Nearby does not record the room.
        </p>
      </footer>
    </div>
  );
}
