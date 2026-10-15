import { TESTIMONIALS } from "@/lib/testimonials";

export function Testimonials() {
  if (TESTIMONIALS.length === 0) return null;
  return (
    <section className="px-5 pb-20" aria-labelledby="testimonials-heading">
      <div className="mx-auto max-w-5xl">
        <h2 id="testimonials-heading" className="font-display text-3xl font-medium">
          What people say
        </h2>
        <div className="mt-6 grid gap-8 sm:grid-cols-3">
          {TESTIMONIALS.map((testimonial) => (
            <figure
              key={`${testimonial.firstName}-${testimonial.quote}`}
              className="border-t border-ink/20 pt-4"
            >
              <blockquote className="font-display text-lg italic leading-snug text-ink">
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
