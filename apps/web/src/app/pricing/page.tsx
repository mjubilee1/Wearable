import type { Metadata } from "next";
import { MarketingNav } from "@/components/MarketingNav";
import { PricingFaq } from "@/components/PricingFaq";
import { PricingSection } from "@/components/PricingSection";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Nearby Free and Pro. 20 requests a day on Free, including reschedules and drafts. Messages are free. Unlimited on Pro for $29 a month or $249 a year, with a 7-day trial.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <div className="min-h-dvh text-ink">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
        <h1 className="font-display text-5xl font-medium leading-none sm:text-6xl">
          Talk. It does it.
        </h1>
        <p className="mt-4 max-w-xl text-base text-muted">
          Start free. Move to Pro when the daily limit gets in the way. The
          trial is 7 days, and the card is charged when it ends.
        </p>
        <div className="mt-10">
          <PricingSection showHeading={false} proTrialCta />
        </div>
        <PricingFaq />
      </main>
    </div>
  );
}
