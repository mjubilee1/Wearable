import { PRICING_FAQ } from "@/lib/site";

export function PricingFaq() {
  return (
    <section className="mt-16">
      <h2 className="font-display text-3xl font-medium">Questions</h2>
      <div className="mt-4">
        {PRICING_FAQ.map((item) => (
          <details key={item.q} className="group border-b border-black/10 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
              {item.q}
              <span aria-hidden className="text-2xl font-light text-muted group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
