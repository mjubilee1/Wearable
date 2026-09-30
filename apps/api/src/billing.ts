import Stripe from "stripe";
import type { PlanTier, SubscriptionStatus } from "@nearby/shared";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

let stripeClient: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID_NEARBY_PLUS,
  );
}

export function isStripeWebhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

export function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  stripeClient = new Stripe(key);
  return stripeClient;
}

export function nearbyPlusPriceId(): string {
  const id = process.env.STRIPE_PRICE_ID_NEARBY_PLUS;
  if (!id) throw new Error("STRIPE_PRICE_ID_NEARBY_PLUS is not set");
  return id;
}

export function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:3000"
  );
}

function statusFromStripe(
  status: Stripe.Subscription.Status,
): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "unpaid":
      return "unpaid";
    case "incomplete":
      return "incomplete";
    case "incomplete_expired":
    case "paused":
      return "canceled";
    default:
      return "none";
  }
}

function planFromStatus(status: SubscriptionStatus): PlanTier {
  return status === "active" || status === "trialing" ? "plus" : "free";
}

export async function upsertBillingOnUser(
  uid: string,
  patch: {
    plan: PlanTier;
    subscriptionStatus: SubscriptionStatus;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  },
): Promise<void> {
  if (!isFirebaseConfigured()) {
    console.warn("[billing] Firebase not configured; skipping profile write", {
      uid,
      ...patch,
    });
    return;
  }

  const ref = getFirebaseAdmin().firestore().collection("users").doc(uid);
  await ref.set(
    {
      ...patch,
      planUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

export async function ensureStripeCustomer(opts: {
  uid: string;
  email?: string;
  existingCustomerId?: string | null;
}): Promise<string> {
  const stripe = getStripe();

  if (opts.existingCustomerId) {
    return opts.existingCustomerId;
  }

  const customer = await stripe.customers.create({
    email: opts.email || undefined,
    metadata: { firebaseUid: opts.uid },
  });

  await upsertBillingOnUser(opts.uid, {
    plan: "free",
    subscriptionStatus: "none",
    stripeCustomerId: customer.id,
    stripeSubscriptionId: null,
  });

  return customer.id;
}

export async function createCheckoutSession(opts: {
  uid: string;
  email?: string;
  stripeCustomerId?: string | null;
}): Promise<{ url: string }> {
  const stripe = getStripe();
  const customerId = await ensureStripeCustomer({
    uid: opts.uid,
    email: opts.email,
    existingCustomerId: opts.stripeCustomerId,
  });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: opts.uid,
    line_items: [{ price: nearbyPlusPriceId(), quantity: 1 }],
    success_url: `${appBaseUrl()}/profile?billing=success`,
    cancel_url: `${appBaseUrl()}/profile?billing=canceled`,
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { firebaseUid: opts.uid },
    },
    metadata: { firebaseUid: opts.uid },
  });

  if (!session.url) throw new Error("Stripe Checkout did not return a URL");
  return { url: session.url };
}

export async function createPortalSession(opts: {
  stripeCustomerId: string;
}): Promise<{ url: string }> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: opts.stripeCustomerId,
    return_url: `${appBaseUrl()}/profile`,
  });
  return { url: session.url };
}

async function resolveUidFromSubscription(
  subscription: Stripe.Subscription,
  fallbackUid?: string,
): Promise<string | undefined> {
  if (subscription.metadata?.firebaseUid) {
    return subscription.metadata.firebaseUid;
  }
  if (fallbackUid) return fallbackUid;

  if (typeof subscription.customer === "string") {
    const customer = await getStripe().customers.retrieve(subscription.customer);
    if (!customer.deleted) return customer.metadata?.firebaseUid;
  }
  return undefined;
}

async function applySubscription(
  subscription: Stripe.Subscription,
  fallbackUid?: string,
): Promise<void> {
  const uid = await resolveUidFromSubscription(subscription, fallbackUid);
  if (!uid) {
    console.warn("[billing] No firebaseUid on subscription", subscription.id);
    return;
  }

  const status = statusFromStripe(subscription.status);
  await upsertBillingOnUser(uid, {
    plan: planFromStatus(status),
    subscriptionStatus: status,
    stripeCustomerId:
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
  });
}

export async function handleStripeWebhook(
  rawBody: string,
  signature: string,
): Promise<void> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const uid = session.client_reference_id || session.metadata?.firebaseUid;
      if (!uid || session.mode !== "subscription") break;

      const subId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (!subId) break;

      const subscription = await stripe.subscriptions.retrieve(subId);
      await applySubscription(subscription, uid);
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.created": {
      await applySubscription(event.data.object as Stripe.Subscription);
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      let uid = subscription.metadata?.firebaseUid;
      if (!uid && typeof subscription.customer === "string") {
        const customer = await stripe.customers.retrieve(subscription.customer);
        if (!customer.deleted) uid = customer.metadata?.firebaseUid;
      }
      if (!uid) break;
      await upsertBillingOnUser(uid, {
        plan: "free",
        subscriptionStatus: "canceled",
        stripeCustomerId:
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id,
        stripeSubscriptionId: null,
      });
      break;
    }
    default:
      break;
  }
}
