/**
 * No email provider is configured in this repo (no Resend, Postmark, or SendGrid).
 *
 * TODO: Day 0 welcome — send when an account is created.
 * TODO: Day 5 — daily job for users whose trialEndsAt is about 48 hours out:
 *       "Your Pro trial ends in 2 days."
 * TODO: Payment failed — send when Stripe emits invoice.payment_failed.
 *       notifyPaymentFailed is called from the webhook and only logs until a provider exists.
 */

export function notifyWelcome(uid: string): void {
  console.info("[email] TODO welcome", { uid });
}

export function notifyTrialEnding(uid: string, trialEndsAt: number): void {
  console.info("[email] TODO trial ending", { uid, trialEndsAt });
}

export function notifyPaymentFailed(uid: string): void {
  console.info("[email] TODO payment failed", { uid });
}
