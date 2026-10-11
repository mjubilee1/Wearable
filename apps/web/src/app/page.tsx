import { MarketingAccountLink } from "@/components/MarketingAccountLink";
import { MarketingNav } from "@/components/MarketingNav";
import { WaitlistForm } from "@/components/WaitlistForm";

export default function HomePage() {
  return (
    <div id="top" className="min-h-dvh">
      <MarketingNav />

      <main className="mx-auto flex w-full max-w-2xl flex-col px-5 pb-24 pt-16 sm:px-8 sm:pt-24">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
          Nearby
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-ink sm:text-5xl sm:leading-[1.1]">
          Speak, and it answers out loud.
        </h1>
        <p className="mt-5 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
          Nearby is a voice assistant for the day — so you don&apos;t have to
          pull out your phone to remember, note, or look something up.
        </p>

        <div id="waitlist" className="mt-10">
          <WaitlistForm />
        </div>

        <p className="mt-8 text-xs text-muted">
          Early proof of concept. Not for sale yet.{" "}
          <MarketingAccountLink
            className="font-semibold text-teal"
            signedInLabel="Open the app"
            signedOutLabel="Already have access? Sign in"
          />
        </p>
      </main>
    </div>
  );
}
