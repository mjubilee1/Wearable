import { MarketingAccountLink } from "@/components/MarketingAccountLink";
import { MarketingNav } from "@/components/MarketingNav";

const STEPS = [
  {
    n: "01",
    title: "You speak",
    body: "Headphones or a laptop mic. Your hands stay on what you're doing.",
  },
  {
    n: "02",
    title: "It does the task",
    body: "Calendar, notes, reminders, and other tools — only the ones you allow.",
  },
  {
    n: "03",
    title: "It answers out loud",
    body: "A short spoken reply. Then it gets out of the way.",
  },
] as const;

const MOMENTS = [
  {
    when: "Morning",
    line: "Today's agenda, what's coming up, and the follow-up you already mentioned.",
  },
  {
    when: "At work",
    line: "Capture a note or set a reminder without opening an app.",
  },
  {
    when: "Walking",
    line: "Headphones on. Ask, listen, keep moving.",
  },
] as const;

export default function HomePage() {
  return (
    <div id="top" className="min-h-dvh">
      <MarketingNav />

      <main>
        <section className="mx-auto grid w-full max-w-5xl items-center gap-12 px-5 pb-20 pt-8 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:pt-16">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
              Voice, hands-free
            </p>
            <h1 className="mt-3 max-w-xl text-4xl font-bold tracking-tight text-ink sm:text-6xl sm:leading-[1.05]">
              Speak. It handles it. It answers out loud.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-muted sm:text-lg">
              Nearby is a voice assistant for the day — so you don&apos;t have
              to pull out your phone to remember, note, or look something up.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <MarketingAccountLink
                signedInLabel="Open app"
                className="rounded-full bg-teal px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110"
              />
              <a
                href="#how"
                className="rounded-full px-5 py-3 text-sm font-semibold text-ink"
              >
                How it works
              </a>
            </div>
            <p className="mt-4 text-xs text-muted">
              Early proof of concept. Not for sale yet.
            </p>
          </div>

          <div className="rounded-[28px] border border-black/5 bg-card p-6 shadow-sm sm:p-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
              A morning, in your ear
            </p>
            <div className="mt-6 flex items-end gap-1.5" aria-hidden>
              {[18, 32, 22, 44, 28, 52, 24, 40, 20, 36, 16].map((h, i) => (
                <span
                  key={i}
                  className="w-2 rounded-full bg-teal"
                  style={{ height: h, opacity: 0.35 + (i % 4) * 0.15 }}
                />
              ))}
            </div>
            <div className="mt-8 space-y-4">
              <p className="text-sm text-muted">You</p>
              <p className="text-lg font-semibold tracking-tight text-ink">
                What&apos;s on today?
              </p>
              <p className="text-sm text-muted">Nearby</p>
              <p className="text-lg leading-snug text-ink">
                Two meetings. The first is at 9. You still owe Maya a reply.
              </p>
            </div>
          </div>
        </section>

        <section id="how" className="border-t border-black/5 bg-card/70">
          <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              How it works
            </h2>
            <ol className="mt-10 grid gap-8 sm:grid-cols-3">
              {STEPS.map((step) => (
                <li key={step.n}>
                  <p className="text-[11px] font-bold tracking-[0.16em] text-teal">
                    {step.n}
                  </p>
                  <h3 className="mt-2 text-lg font-bold text-ink">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Through the day
          </h2>
          <ul className="mt-8 divide-y divide-black/5 rounded-[28px] border border-black/5 bg-card">
            {MOMENTS.map((moment) => (
              <li
                key={moment.when}
                className="grid gap-2 px-6 py-6 sm:grid-cols-[140px_1fr] sm:items-baseline sm:px-8"
              >
                <p className="text-sm font-bold text-ink">{moment.when}</p>
                <p className="text-sm leading-relaxed text-muted">{moment.line}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted">
            It remembers the conversation and the preferences you approved.
            It does not keep anything you didn&apos;t ask it to keep.
          </p>
        </section>
      </main>

      <footer className="border-t border-black/5">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-8 sm:px-8">
          <p className="text-sm font-semibold text-ink">Nearby</p>
          <MarketingAccountLink className="text-sm font-semibold text-teal" />
        </div>
      </footer>
    </div>
  );
}
