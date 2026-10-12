export function CalendarDemo() {
  return (
    <figure className="mx-auto w-full max-w-md">
      <div className="overflow-hidden rounded-[28px] bg-white px-5 py-6 shadow-[0_30px_80px_-36px_rgba(17,24,39,0.45)] ring-1 ring-black/[0.04] sm:px-7 sm:py-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
          You
        </p>
        <p className="mt-3 text-xl font-semibold leading-snug tracking-[-0.03em] sm:text-2xl">
          “Move my 3 PM to tomorrow at 10.”
        </p>
        <div className="nearby-demo-receipt mt-6 rounded-2xl bg-teal-soft px-4 py-3">
          <p className="text-sm text-ink">
            <span className="font-semibold text-teal">Done:</span> Moved standup
            to tomorrow at 10:00 AM
          </p>
        </div>
      </div>
      <figcaption className="sr-only">
        A calendar request followed by a Done receipt.
      </figcaption>
    </figure>
  );
}
