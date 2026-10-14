export type Testimonial = {
  quote: string;
  firstName: string;
  role: string;
};

/**
 * Add verified customer quotes here. The homepage hides the section while
 * this array is empty so placeholder social proof is never published.
 */
export const TESTIMONIALS: Testimonial[] = [];
