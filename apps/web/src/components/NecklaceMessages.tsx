const SPOKEN = [
  "Message Maya. Running five minutes late.",
  "Tell Jordan the deck is in his inbox.",
  "Message Priya. I'll call after this meeting.",
];

export function NecklaceMessages() {
  return (
    <section id="messages" className="scroll-mt-16 px-5 pb-20" aria-labelledby="messages-heading">
      <div className="mx-auto grid max-w-5xl items-center gap-10 border-t border-ink/15 pt-10 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div>
          <p className="text-sm text-muted">From the necklace</p>
          <h2
            id="messages-heading"
            className="font-display mt-3 max-w-[14ch] text-4xl font-medium leading-tight text-ink sm:text-5xl"
          >
            Message someone without taking your phone out.
          </h2>
          <p className="mt-4 max-w-md text-lg leading-snug text-ink">
            Say who and what. It lands in a normal chat, the same kind of thread you already use.
          </p>
          <ol className="mt-6 space-y-3">
            {SPOKEN.map((line) => (
              <li key={line} className="font-display text-xl italic leading-snug text-ink">
                “{line}”
              </li>
            ))}
          </ol>
        </div>

        <figure className="w-full border border-ink/20 bg-white">
          <div className="flex items-baseline justify-between border-b border-ink/10 px-4 py-2">
            <p className="text-xs text-muted">You said</p>
            <p className="font-display text-sm italic text-teal">nearby</p>
          </div>
          <p className="font-display px-4 py-5 text-2xl italic leading-snug text-ink">
            “Message Maya. Running five minutes late.”
          </p>
          <div className="space-y-2 border-t border-ink/10 bg-surface px-4 py-4">
            <div className="flex justify-end">
              <p className="max-w-[16rem] rounded-2xl rounded-br-md bg-teal px-3 py-2 text-sm text-white">
                Running five minutes late.
              </p>
            </div>
            <div className="flex justify-start">
              <p className="max-w-[16rem] rounded-2xl rounded-bl-md bg-white px-3 py-2 text-sm text-ink shadow-sm">
                All good. Starting without you.
              </p>
            </div>
          </div>
          <figcaption className="border-t border-ink/10 px-4 py-3 text-sm text-ink">
            <span className="font-semibold">Sent.</span> Maya has it in Messages.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
