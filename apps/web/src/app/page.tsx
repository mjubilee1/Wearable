// PARITY: mobile — marketing landing is web-only.
import type { Metadata } from "next";
import { MarketingAccountLink } from "@/components/MarketingAccountLink";
import { MarketingNav } from "@/components/MarketingNav";
import { WaitlistForm } from "@/components/WaitlistForm";
import { QUESTIONS, siteJsonLd } from "@/lib/site";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    types: { "text/plain": "/llms.txt" },
  },
};

const STEPS = [
  {
    label: "01",
    title: "You speak",
    body: "Ask from a laptop or headphones. The small stuff doesn’t need an app open in your hand.",
  },
  {
    label: "02",
    title: "It does the task",
    body: "Calendar, notes, and reminders — tools run only when you allow them.",
  },
  {
    label: "03",
    title: "It answers, then stops",
    body: "A short reply out loud. Then quiet. Nearby is there for the job, not the company.",
  },
] as const;

const DAY = [
  {
    when: "Morning",
    title: "Today, before you pick up the phone.",
    body: "Agenda, meetings, reminders, and a short picture of what’s next.",
  },
  {
    when: "At work",
    title: "Capture it while you’re still in the thought.",
    body: "A note, a task, a reminder, or a question — spoken, then handled.",
  },
  {
    when: "On the move",
    title: "Hands free, through headphones.",
    body: "Walk or commute and still get a spoken answer. The phone stays put.",
  },
  {
    when: "Through the day",
    title: "It acts when you ask, then stops.",
    body: "A note, a reminder, or a fact when you ask for one. Short answers. Nothing kept just because you were nearby.",
  },
] as const;

const REFUSE = [
  {
    title: "Not a phone in a box",
    body: "If the job is easier on the phone you already carry, we don’t ship a gadget for it.",
  },
  {
    title: "Not a companion",
    body: "No chatty friend in your ear. Short answers. Then it gets out of the way.",
  },
  {
    title: "Not a recorder",
    body: "We don’t quietly capture the room. It acts when you speak to it.",
  },
] as const;

const BARS = [10, 18, 28, 14, 36, 22, 12, 32, 20, 40, 16, 26, 12, 34, 22, 14, 30, 18, 10, 24];

export default function HomePage() {
  return (
    <div id="top" className="min-h-dvh scroll-smooth text-ink">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }}
      />
      <MarketingNav />

      <main>
        <section className="px-5 pb-6 pt-16 text-center sm:pt-24">
          <p className="text-sm font-semibold text-teal">Nearby</p>
          <h1 className="mx-auto mt-5 max-w-4xl text-[2.75rem] font-bold leading-[1.02] tracking-[-0.035em] sm:text-6xl lg:text-7xl">
            Speak, and it answers out loud.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            A voice assistant for the day — calendar, notes, reminders — so you
            don’t pull out your phone for the small stuff. Useful first.
            Hardware later.
          </p>
          <div id="waitlist" className="mx-auto mt-10 max-w-md scroll-mt-24">
            <WaitlistForm />
          </div>
        </section>

        <section className="px-4 pb-8 pt-10 sm:px-6" aria-label="A spoken exchange">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-[28px] bg-teal-soft px-5 py-14 sm:rounded-[36px] sm:px-10 sm:py-24">
            <figure className="mx-auto max-w-lg">
              <div className="rounded-[28px] bg-white px-6 py-7 shadow-[0_30px_80px_-36px_rgba(17,24,39,0.45)] ring-1 ring-black/[0.04] sm:px-8 sm:py-9">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-2.5 w-2.5" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-50" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-teal" />
                  </span>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                    You
                  </p>
                </div>
                <p className="mt-5 text-[1.65rem] font-semibold leading-snug tracking-[-0.03em] sm:text-3xl">
                  “What’s left on today?”
                </p>
                <div className="mt-6 flex h-10 items-end gap-[5px]" aria-hidden>
                  {BARS.map((height, index) => (
                    <span
                      key={index}
                      className="w-[3px] rounded-full bg-teal"
                      style={{ height }}
                    />
                  ))}
                </div>
                <div className="mt-8 border-t border-black/5 pt-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal">
                    Spoken back
                  </p>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink/90">
                    Design review at 2. A reminder for the deck at 1:30. That’s
                    it.
                  </p>
                </div>
              </div>
              <figcaption className="sr-only">
                Example of a short spoken question and a short spoken answer.
              </figcaption>
            </figure>
          </div>
        </section>

        <section id="how" className="scroll-mt-16 px-5 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-semibold text-teal">How it works</p>
            <h2 className="mt-4 max-w-3xl text-4xl font-bold tracking-[-0.035em] sm:text-5xl sm:leading-[1.05]">
              You speak. It does the task. Then it gets quiet.
            </h2>
            <ol className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-8">
              {STEPS.map((step) => (
                <li key={step.label}>
                  <p className="text-xs font-semibold tracking-[0.16em] text-teal">
                    {step.label}
                  </p>
                  <h3 className="mt-3 text-xl font-semibold tracking-tight">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="day" className="scroll-mt-16 bg-coral-soft px-5 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-semibold text-coral">The day</p>
            <h2 className="mt-4 max-w-3xl text-4xl font-bold tracking-[-0.035em] sm:text-5xl sm:leading-[1.05]">
              Built for the day you already have.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Morning, work, and the walk between them. Spoken help for real
              tasks, then silence.
            </p>
            <ul className="mt-12 grid gap-4 sm:grid-cols-2">
              {DAY.map((item) => (
                <li
                  key={item.when}
                  className="rounded-[28px] bg-white p-7 ring-1 ring-black/[0.04] sm:p-8"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-coral">
                    {item.when}
                  </p>
                  <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted">
                    {item.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="refuse" className="scroll-mt-16 bg-ink px-5 py-20 text-white sm:py-28">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-semibold text-teal-soft">What we refuse</p>
            <h2 className="mt-4 max-w-3xl text-4xl font-bold tracking-[-0.035em] sm:text-5xl sm:leading-[1.05]">
              Prove the job before anyone wears a new thing.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/65 sm:text-lg">
              The last wave of AI wearables sold a vibe: a cute device, a demo,
              then a drawer. Nearby starts the other way — a loop on a laptop
              or headphones that earns a device later.
            </p>
            <ul className="mt-14 grid gap-4 sm:grid-cols-3">
              {REFUSE.map((item) => (
                <li
                  key={item.title}
                  className="rounded-[28px] bg-white/[0.06] p-7 ring-1 ring-teal/30"
                >
                  <h3 className="text-lg font-semibold tracking-tight">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-white/65">
                    {item.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="px-5 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-semibold text-teal">Where it is now</p>
            <h2 className="mt-4 max-w-3xl text-4xl font-bold tracking-[-0.035em] sm:text-5xl sm:leading-[1.05]">
              Laptop and headphones first.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
              Early proof of concept. Not for sale. The voice loop has to be
              something worth using every day before there’s a thing to wear.
            </p>
            <a
              href="#waitlist"
              className="mt-8 inline-flex rounded-full bg-teal px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Get updates
            </a>
          </div>
        </section>

        <section id="questions" className="scroll-mt-16 border-t border-black/5 px-5 py-20 sm:py-28">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
            <h2 className="text-4xl font-bold tracking-[-0.035em] sm:text-5xl sm:leading-[1.05]">
              Questions
            </h2>
            <div>
              {QUESTIONS.map((item) => (
                <details
                  key={item.q}
                  className="group border-b border-black/10 py-5"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-base font-semibold tracking-tight sm:text-lg [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span
                      aria-hidden
                      className="text-2xl font-light leading-none text-muted transition group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/10 px-5 py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 sm:flex-row sm:justify-between">
          <div>
            <p className="text-2xl font-extrabold tracking-[-0.04em] text-teal">
              nearby
            </p>
            <p className="mt-2 max-w-xs text-sm text-muted">
              Speak, and it answers out loud.
            </p>
          </div>
          <div className="flex gap-14 text-sm">
            <div className="flex flex-col gap-2">
              <p className="font-semibold">Product</p>
              <a href="#how" className="text-muted hover:text-ink">
                How it works
              </a>
              <a href="#day" className="text-muted hover:text-ink">
                The day
              </a>
              <a href="#refuse" className="text-muted hover:text-ink">
                What we refuse
              </a>
            </div>
            <div className="flex flex-col gap-2">
              <p className="font-semibold">Account</p>
              <MarketingAccountLink className="text-muted hover:text-ink" />
              <a href="#waitlist" className="text-muted hover:text-ink">
                Get updates
              </a>
            </div>
          </div>
        </div>
        <p className="mx-auto mt-12 max-w-6xl text-xs text-muted">
          © 2026 Nearby · nearbyhello.com
        </p>
      </footer>
    </div>
  );
}
