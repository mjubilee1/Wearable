import Stripe from "stripe";
import {
  hasProAccess,
  PRO_TRIAL_DAYS,
  type BillingInterval,
  type PlanTier,
  type SubscriptionStatus,
} from "@nearby/shared";
import { notifyPaymentFailed } from "./emails.js";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

let stripeClient: Stripe | null = null;

export function monthlyPriceId(): string | null {
  return (
    process.env.STRIPE_PRICE_ID_PRO_MONTHLY?.trim() ||
    process.env.STRIPE_PRICE_ID_NEARBY_PLUS?.trim() ||
    null
  );
}

export function yearlyPriceId(): string | null {
  return process.env.STRIPE_PRICE_ID_PRO_YEARLY?.trim() || null;
}

export function priceIdFor(interval: BillingInterval): string {
  const id = interval === "year" ? yearlyPriceId() : monthlyPriceId();
  if (!id) {
    throw new Error(
      interval === "year"
        ? "STRIPE_PRICE_ID_PRO_YEARLY is not set"
        : "STRIPE_PRICE_ID_PRO_MONTHLY is not set",
    );
  }
  return id;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && monthlyPriceId());
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

export function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:3000"
  );
}

export type BillingPatch = {
  plan?: PlanTier;
  subscriptionStatus?: SubscriptionStatus;
  stripeCustomerId?: string | null;
  stripeCustomerIdTest?: string | null;
  stripeCustomerIdLive?: string | null;
  stripeSubscriptionId?: string | null;
  trialEndsAt?: number | null;
  currentPeriodEnd?: number | null;
  cancelAtPeriodEnd?: boolean;
  billingInterval?: BillingInterval | null;
  paymentFailedAt?: number | null;
};

function statusFromStripe(status: Stripe.Subscription.Status): SubscriptionStatus {
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
  return status === "active" || status === "trialing" || status === "past_due"
    ? "pro"
    : "free";
}

function intervalOf(subscription: Stripe.Subscription): BillingInterval | null {
  const interval = subscription.items?.data?.[0]?.price?.recurring?.interval;
  if (interval === "month") return "month";
  if (interval === "year") return "year";
  return null;
}

function periodEndMs(subscription: Stripe.Subscription): number | null {
  const end = subscription.items?.data?.[0]?.current_period_end;
  return typeof end === "number" ? end * 1000 : null;
}

export async function upsertBillingOnUser(
  uid: string,
  patch: BillingPatch,
): Promise<void> {
  if (!isFirebaseConfigured()) {
    console.warn("[billing] Firebase not configured; skipping profile write", {
      uid,
      plan: patch.plan,
      subscriptionStatus: patch.subscriptionStatus,
    });
    return;
  }

  const ref = getFirebaseAdmin().firestore().collection("users").doc(uid);
  const fields: Record<string, unknown> = {
    planUpdatedAt: Date.now(),
    updatedAt: Date.now(),
  };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) fields[key] = value;
  }
  await ref.set(fields, { merge: true });
}

/** Test keys contain `_test_`. Live secret and restricted keys do not. */
export function stripeMode(): "test" | "live" {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  return key.includes("_test_") ? "test" : "live";
}

export function stripeCustomerIdForProfile(profile: {
  stripeCustomerId?: string | null;
  stripeCustomerIdTest?: string | null;
  stripeCustomerIdLive?: string | null;
}): string | null {
  const specific =
    stripeMode() === "test"
      ? profile.stripeCustomerIdTest
      : profile.stripeCustomerIdLive;
  if (typeof specific === "string" && specific.trim()) return specific.trim();
  if (typeof profile.stripeCustomerId === "string" && profile.stripeCustomerId.trim()) {
    return profile.stripeCustomerId.trim();
  }
  return null;
}

function customerIdPatch(customerId: string): BillingPatch {
  if (stripeMode() === "test") {
    return {
      stripeCustomerId: customerId,
      stripeCustomerIdTest: customerId,
    };
  }
  return {
    stripeCustomerId: customerId,
    stripeCustomerIdLive: customerId,
  };
}

function isMissingCustomer(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const row = err as { code?: string; message?: string };
  if (row.code === "resource_missing") return true;
  return typeof row.message === "string" && /no such customer/i.test(row.message);
}

async function lookupCustomer(
  stripe: Stripe,
  id: string,
): Promise<"ok" | "missing" | "foreign"> {
  try {
    const customer = await stripe.customers.retrieve(id);
    if ("deleted" in customer && customer.deleted) return "missing";
    return "ok";
  } catch (err) {
    if (isMissingCustomer(err)) return "foreign";
    throw err;
  }
}

export async function ensureStripeCustomer(opts: {
  uid: string;
  email?: string;
  stripeCustomerId?: string | null;
  stripeCustomerIdTest?: string | null;
  stripeCustomerIdLive?: string | null;
}): Promise<string> {
  const stripe = getStripe();
  const mode = stripeMode();
  const specific =
    mode === "test" ? opts.stripeCustomerIdTest : opts.stripeCustomerIdLive;
  const ordered = [specific, opts.stripeCustomerId].filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0,
  );
  const seen = new Set<string>();
  const foreignIds: string[] = [];
  for (const raw of ordered) {
    const id = raw.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const found = await lookupCustomer(stripe, id);
    if (found === "foreign") foreignIds.push(id);
    if (found !== "ok") continue;
    const alreadySaved =
      opts.stripeCustomerId === id &&
      (mode === "test"
        ? opts.stripeCustomerIdTest === id
        : opts.stripeCustomerIdLive === id);
    if (!alreadySaved) {
      await upsertBillingOnUser(opts.uid, customerIdPatch(id));
    }
    return id;
  }

  const customer = await stripe.customers.create({
    email: opts.email || undefined,
    metadata: { firebaseUid: opts.uid },
  });
  const patch = customerIdPatch(customer.id);
  const otherValue =
    mode === "test" ? opts.stripeCustomerIdLive : opts.stripeCustomerIdTest;
  const legacy = opts.stripeCustomerId?.trim();
  if (
    !otherValue &&
    legacy &&
    foreignIds.includes(legacy) &&
    legacy !== customer.id
  ) {
    if (mode === "test") patch.stripeCustomerIdLive = legacy;
    else patch.stripeCustomerIdTest = legacy;
  }
  await upsertBillingOnUser(opts.uid, patch);
  return customer.id;
}

export async function createCheckoutSession(opts: {
  uid: string;
  email?: string;
  stripeCustomerId?: string | null;
  stripeCustomerIdTest?: string | null;
  stripeCustomerIdLive?: string | null;
  interval: BillingInterval;
}): Promise<{ url: string }> {
  const stripe = getStripe();
  const customerId = await ensureStripeCustomer({
    uid: opts.uid,
    email: opts.email,
    stripeCustomerId: opts.stripeCustomerId,
    stripeCustomerIdTest: opts.stripeCustomerIdTest,
    stripeCustomerIdLive: opts.stripeCustomerIdLive,
  });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: opts.uid,
    line_items: [{ price: priceIdFor(opts.interval), quantity: 1 }],
    success_url: `${appBaseUrl()}/activity?billing=success`,
    cancel_url: `${appBaseUrl()}/profile?billing=canceled`,
    allow_promotion_codes: true,
    payment_method_collection: "always",
    subscription_data: {
      trial_period_days: PRO_TRIAL_DAYS,
      metadata: {
        firebaseUid: opts.uid,
        plan: "pro",
        interval: opts.interval,
      },
    },
    metadata: {
      firebaseUid: opts.uid,
      plan: "pro",
      interval: opts.interval,
    },
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

function customerIdOf(subscription: Stripe.Subscription): string | null {
  if (typeof subscription.customer === "string") return subscription.customer;
  return subscription.customer?.id ?? null;
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
  const paid = status === "active" || status === "trialing" || status === "past_due";
  const customerId = customerIdOf(subscription);
  await upsertBillingOnUser(uid, {
    plan: planFromStatus(status),
    subscriptionStatus: status,
    ...(customerId ? customerIdPatch(customerId) : { stripeCustomerId: null }),
    stripeSubscriptionId: paid ? subscription.id : null,
    trialEndsAt:
      typeof subscription.trial_end === "number"
        ? subscription.trial_end * 1000
        : null,
    currentPeriodEnd: periodEndMs(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    billingInterval: intervalOf(subscription),
    ...(paid && status !== "past_due" ? { paymentFailedAt: null } : {}),
  });
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const details = invoice.parent?.subscription_details;
  if (!details) return null;
  const sub = details.subscription;
  return typeof sub === "string" ? sub : sub?.id ?? null;
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
      const customerId = customerIdOf(subscription);
      await upsertBillingOnUser(uid, {
        plan: "free",
        subscriptionStatus: "canceled",
        ...(customerId ? customerIdPatch(customerId) : { stripeCustomerId: null }),
        stripeSubscriptionId: null,
        trialEndsAt: null,
        currentPeriodEnd: periodEndMs(subscription),
        cancelAtPeriodEnd: false,
        billingInterval: null,
      });
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = subscriptionIdFromInvoice(invoice);
      if (!subId) break;
      const subscription = await stripe.subscriptions.retrieve(subId);
      await applySubscription(subscription);
      const uid = await resolveUidFromSubscription(subscription);
      if (!uid) break;
      await upsertBillingOnUser(uid, {
        plan: hasProAccess({
          plan: planFromStatus(statusFromStripe(subscription.status)),
          subscriptionStatus: statusFromStripe(subscription.status),
        })
          ? "pro"
          : "free",
        subscriptionStatus: statusFromStripe(subscription.status),
        paymentFailedAt: Date.now(),
      });
      notifyPaymentFailed(uid);
      break;
    }
    default:
      break;
  }
}
