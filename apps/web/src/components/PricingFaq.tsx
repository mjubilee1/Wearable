const FAQ = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel in the billing portal. You keep Pro until the end of the period you already started. Cancel during the 7-day trial and the card is not charged.",
  },
  {
    q: "What counts as a request?",
    a: "Each thing you ask Nearby to do counts as one request. Free includes 20 a day. Reschedules and email drafts are counted on their own: 3 of each per day. Counters reset at midnight in your timezone.",
  },
  {
    q: "What about privacy?",
    a: "Nearby does not record the room. A connector runs only when you ask. Stripe handles the card. Your plan is stored on your account so the limit is enforced on the server, not only in the app.",
  },
] as const;

export function PricingFaq() {
  return (
    <section className="mt-16">
      <h2 className="text-2xl font-bold tracking-tight">Questions</h2>
      <div className="mt-4">
        {FAQ.map((item) => (
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
