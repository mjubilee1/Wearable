import { TESTIMONIALS } from "@/lib/testimonials";

export function Testimonials() {
  if (TESTIMONIALS.length === 0) return null;
  return (
    <section className="px-5 pb-20" aria-labelledby="testimonials-heading">
      <div className="mx-auto max-w-4xl">
        <h2 id="testimonials-heading" className="text-center text-2xl font-bold tracking-tight">
          What people say
        </h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {TESTIMONIALS.map((testimonial) => (
            <figure
              key={`${testimonial.firstName}-${testimonial.quote}`}
              className="rounded-[28px] bg-white p-6 ring-1 ring-black/5"
            >
              <blockquote className="text-sm leading-relaxed text-ink">
                “{testimonial.quote}”
              </blockquote>
              <figcaption className="mt-4 text-xs text-muted">
                <span className="font-bold text-ink">{testimonial.firstName}</span>
                {" · "}
                {testimonial.role}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
