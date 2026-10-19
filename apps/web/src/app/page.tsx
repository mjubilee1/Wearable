// PARITY: mobile — marketing landing and pricing are web-only.
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDemo } from "@/components/CalendarDemo";
import { LandingView } from "@/components/LandingView";
import { HomepageLiveDemo } from "@/components/HomepageLiveDemo";
import { NecklaceMessages } from "@/components/NecklaceMessages";
import { BrandMark } from "@/components/BrandMark";
import { MarketingNav } from "@/components/MarketingNav";
import { PricingSection } from "@/components/PricingSection";
import { ScrollToDemo } from "@/components/ScrollToDemo";
import { WaitlistForm } from "@/components/WaitlistForm";
import { Testimonials } from "@/components/Testimonials";
import { sanitizeUtmSource, signupHref } from "@/lib/attribution";
import {
  CONNECTOR_PRIVACY_LINE,
  SITE_DESCRIPTION,
  SITE_TITLE,
  siteJsonLd,
} from "@/lib/site";

const AUDIENCES = {
  general: {
    headline: "Hang up. Say the follow-up. Keep driving.",
    builtFor: "Built for recruiters, sales reps, and consultants.",
    subhead:
      "You say what happened. Nearby drafts the email, puts the time on your calendar, and parks the task in Google Tasks — in the accounts you already use.",
    examples: [
      { title: "Move a call", body: "Move my 2 PM prospect call to tomorrow at 10." },
      {
        title: "Draft the follow-up",
        body: "Draft a follow-up to Maya after today's demo.",
      },
      {
        title: "Remember the pricing",
        body: "Remind me to send Maya the pricing recap Friday.",
      },
    ],
    demo: {
      request: "Follow up with Dana Thursday about pricing.",
      receipt: "Draft in Gmail · hold on calendar · task saved",
    },
  },
  recruiters: {
    headline: "Off a screen? Capture the next step before the next call.",
    builtFor: "Built for recruiters.",
    subhead:
      "You say what happened. Nearby drafts the email, puts the time on your calendar, and parks the task in Google Tasks — in the accounts you already use.",
    examples: [
      {
        title: "Draft candidate feedback",
        body: "Draft feedback for Maya after today's product screen.",
      },
      {
        title: "Hold a screen time",
        body: "Hold Thursday at 2 for Jordan's next screen.",
      },
      {
        title: "Ping the hiring manager",
        body: "Remind me Friday to ask Sam for feedback.",
      },
    ],
    demo: {
      request: "Follow up with Dana Thursday about the next interview.",
      receipt: "Draft in Gmail · hold on calendar · task saved",
    },
  },
  sales: {
    headline: "Hang up. Say the follow-up. Keep driving.",
    builtFor: "Built for sales reps.",
    subhead:
      "You say what happened. Nearby drafts the email, puts the time on your calendar, and parks the task in Google Tasks — in the accounts you already use.",
    examples: [
      {
        title: "Move a call",
        body: "Move my 2 PM prospect call to tomorrow at 10.",
      },
      {
        title: "Draft the follow-up",
        body: "Draft a follow-up to Maya after today's demo.",
      },
      {
        title: "Remember the pricing",
        body: "Remind me to send Maya the pricing recap Friday.",
      },
    ],
    demo: {
      request: "Follow up with Dana Thursday about pricing.",
      receipt: "Draft in Gmail · hold on calendar · task saved",
    },
  },
  consultants: {
    headline: "Between clients, get the email out of your head.",
    builtFor: "Built for consultants.",
    subhead:
      "You say what happened. Nearby drafts the email, puts the time on your calendar, and parks the task in Google Tasks — in the accounts you already use.",
    examples: [
      {
        title: "Draft the client recap",
        body: "Draft a recap for Maya from today's strategy session.",
      },
      {
        title: "Move the kickoff",
        body: "Move the Acme kickoff to Thursday at 10.",
      },
      {
        title: "Send the proposal",
        body: "Remind me Friday to send Maya the proposal.",
      },
    ],
    demo: {
      request: "Follow up with Dana Thursday about the proposal.",
      receipt: "Draft in Gmail · hold on calendar · task saved",
    },
  },
  managers: {
    headline: "Leave the meeting. Capture what happens next.",
    builtFor: "Built for managers.",
    subhead:
      "You say what happened. Nearby drafts the email, puts the time on your calendar, and parks the task in Google Tasks — in the accounts you already use.",
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
    headline: "Leave the showing. Say the next step before you drive.",
    builtFor: "Built for real estate agents.",
    subhead:
      "You say what happened. Nearby drafts the email, puts the time on your calendar, and parks the task in Google Tasks — in the accounts you already use.",
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

type HomeSearch = {
  for?: string | string[];
  utm_source?: string | string[];
  utm_medium?: string | string[];
  utm_campaign?: string | string[];
  v?: string | string[];
};

type HomeSearchParams = Promise<HomeSearch>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isFacebookLanding(params: HomeSearch): boolean {
  if (sanitizeUtmSource(firstParam(params.utm_source)) === "facebook") return true;
  return firstParam(params.v)?.trim().toLowerCase() === "fb";
}

function homePassthroughQuery(params: HomeSearch): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "for"] as const) {
    const value = firstParam(params[key]);
    if (value) query.set(key, value);
  }
  return query;
}

function homeSignupHref(params: HomeSearch): string {
  return signupHref(homePassthroughQuery(params));
}

function homePricingHref(params: HomeSearch): string {
  const suffix = homePassthroughQuery(params).toString();
  return suffix ? `/pricing?${suffix}` : "/pricing";
}

function homeMessagesHref(params: HomeSearch): string {
  const suffix = homePassthroughQuery(params).toString();
  return suffix ? `/?${suffix}#messages` : "/#messages";
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: HomeSearchParams;
}): Promise<Metadata> {
  const audienceKey = audienceFrom((await searchParams).for);
  const audience = AUDIENCES[audienceKey];
  const title = audienceKey === "general" ? SITE_TITLE : audience.headline;
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
  const params = await searchParams;
  const audience = AUDIENCES[audienceFrom(params.for)];
  const facebook = isFacebookLanding(params);
  const accountHref = homeSignupHref(params);
  const pricingHref = homePricingHref(params);
  const messagesHref = homeMessagesHref(params);
  return (
    <div id="top" className="min-h-dvh text-ink">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }}
      />
      <LandingView />
      <MarketingNav
        signupHref={accountHref}
        pricingHref={pricingHref}
        messagesHref={messagesHref}
      />
      <main>
        {facebook ? (
          <section className="mx-auto max-w-5xl px-5 pb-3 pt-4">
            <h1 className="font-display text-[2rem] font-medium leading-[1.05] text-ink">
              Just wrapped a call? Say one sentence. Done.
            </h1>
            <p className="mt-3 max-w-md text-base leading-snug text-ink">
              Say what happened. Nearby drafts the email, puts the time on your
              Google Calendar, and saves the task in Google Tasks.
            </p>
            <p className="mt-2 text-sm text-muted">
              Built for sales reps, recruiters, and consultants.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <ScrollToDemo className="inline-flex bg-ink px-5 py-2.5 text-sm font-semibold text-white">
                Try it free, no signup
              </ScrollToDemo>
              <Link
                href={accountHref}
                className="text-sm font-semibold text-ink underline decoration-teal decoration-2 underline-offset-4"
              >
                Create free account
              </Link>
            </div>
          </section>
        ) : (
          <section className="mx-auto grid max-w-5xl items-end gap-10 px-5 pb-16 pt-12 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:pt-16">
            <div>
              <h1 className="font-display max-w-[11ch] text-5xl font-medium leading-[0.95] text-ink sm:text-7xl">
                {audience.headline}
              </h1>
              <p className="mt-6 max-w-sm text-lg leading-snug text-ink">
                {audience.subhead}
              </p>
              <p className="mt-3 text-sm text-muted">{audience.builtFor}</p>
              <Link
                href={accountHref}
                className="mt-8 inline-flex bg-ink px-5 py-3 text-sm font-semibold text-white"
              >
                Try it free
              </Link>
            </div>
            <CalendarDemo
              request={audience.demo.request}
              receipt={audience.demo.receipt}
            />
          </section>
        )}

        <HomepageLiveDemo
          variant={facebook ? "facebook" : "default"}
          signupHref={accountHref}
        />

        <NecklaceMessages />

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

        <section className="px-5 pb-20" aria-labelledby="same-apps-heading">
          <div className="mx-auto max-w-5xl border-y border-ink/15 py-10">
            <h2
              id="same-apps-heading"
              className="font-display max-w-2xl text-4xl font-medium leading-none sm:text-5xl"
            >
              Same Google apps. No new dashboard to live in.
            </h2>
            <ul className="mt-7 grid gap-4 text-sm leading-relaxed text-ink sm:grid-cols-2">
              <li>Works with the Google Calendar, Gmail, and Tasks you already open every day</li>
              <li>Nothing goes out until you approve the draft</li>
              <li>Talk or type — whichever is faster between calls</li>
              <li>Connect Google and try it free</li>
            </ul>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-16 px-5 pb-20">
          <div className="mx-auto max-w-5xl">
            <PricingSection />
            <p className="mt-4 text-sm text-muted">
              <Link href={pricingHref} className="text-ink underline decoration-teal decoration-2 underline-offset-4">
                Pricing details
              </Link>
            </p>
          </div>
        </section>
      </main>
      <footer className="border-t border-ink/15 px-5 py-12">
        <div className="mx-auto flex max-w-5xl flex-col gap-8 sm:flex-row sm:justify-between">
          <div>
            <BrandMark className="font-display text-3xl italic text-ink" />
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
              <Link href={pricingHref} className="text-muted hover:text-ink">
                FAQ
              </Link>
              <Link href={accountHref} className="text-muted hover:text-ink">
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
