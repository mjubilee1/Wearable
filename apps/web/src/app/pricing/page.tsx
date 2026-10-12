import type { Metadata } from "next";
import { MarketingNav } from "@/components/MarketingNav";
import { PricingFaq } from "@/components/PricingFaq";
import { PricingSection } from "@/components/PricingSection";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Nearby Free, Pro, and Team. Pro is $29/mo or $249/yr. Team is $199/mo for 10 seats. 7-day trial on paid plans.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <div className="min-h-dvh text-ink">
      <MarketingNav />
      <main className="mx-auto max-w-4xl px-5 py-16 sm:py-24">
        <p className="text-sm font-semibold text-teal">Pricing</p>
        <h1 className="mt-3 text-4xl font-bold tracking-[-0.035em] sm:text-5xl">
          Talk. It does it.
        </h1>
        <p className="mt-4 max-w-xl text-base text-muted">
          Start free. Move to Pro or Team when the daily limits get in the way.
          The trial is 7 days, and the card is charged when it ends.
        </p>
        <div className="mt-10">
          <PricingSection showHeading={false} />
        </div>
        <PricingFaq />
      </main>
    </div>
  );
}
