// PARITY: mobile — marketing landing and pricing are web-only.
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDemo } from "@/components/CalendarDemo";
import { LandingView } from "@/components/LandingView";
import { MarketingAccountLink } from "@/components/MarketingAccountLink";
import { MarketingNav } from "@/components/MarketingNav";
import { PricingSection } from "@/components/PricingSection";
import { WaitlistForm } from "@/components/WaitlistForm";
import { CONNECTOR_PRIVACY_LINE, siteJsonLd } from "@/lib/site";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    types: { "text/plain": "/llms.txt" },
  },
};

const TASKS = [
  {
    title: "Tomorrow's first meeting",
    body: "What's my first meeting tomorrow?",
  },
  {
    title: "Move something",
    body: "Move my 3 PM to tomorrow at 10.",
  },
  {
    title: "Draft the reply",
    body: "Draft a reply to the lender saying I'll send docs Friday.",
  },
] as const;

export default function HomePage() {
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
            Speak a calendar change. Get a short answer and a Done receipt.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-flex rounded-full bg-teal px-6 py-3 text-sm font-semibold text-white"
          >
            Start free
          </Link>
        </section>

        <section className="px-5 pb-16" aria-label="Calendar request demo">
          <CalendarDemo />
        </section>

        <section className="px-5 pb-16">
          <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-3">
            {TASKS.map((task) => (
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
