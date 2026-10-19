export function CalendarDemo({
  request,
  receipt,
}: {
  request: string;
  receipt: string;
}) {
  return (
    <figure className="w-full border border-ink/20 bg-white">
      <div className="flex items-baseline justify-between border-b border-ink/10 px-4 py-2">
        <p className="text-xs font-semibold text-muted">You</p>
      </div>
      <p className="font-display px-4 py-5 text-2xl italic leading-snug text-ink">
        “{request}”
      </p>
      <div className="nearby-demo-receipt border-t border-ink/10 px-4 py-3">
        <p className="text-sm text-ink">
          <span className="font-semibold">Done:</span> {receipt}
        </p>
      </div>
      <figcaption className="sr-only">
        A calendar request followed by a Done receipt.
      </figcaption>
    </figure>
  );
}
