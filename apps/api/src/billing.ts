import Stripe from "stripe";
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
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
const priceCache = new Map<BillingInterval, Promise<string>>();

const PRICE_LOOKUP_KEYS: Record<BillingInterval, string> = {
  month: "pro_monthly",
  year: "pro_annual",
};
const FOUNDING_PROMO_CODE = "FOUNDING19";

async function findProProduct(stripe: Stripe): Promise<Stripe.Product> {
  const products = await stripe.products.list({ active: true, limit: 100 });
  const product = products.data.find(
    (item) => item.name.trim().toLowerCase() === "pro",
  );
  if (!product) throw new Error("No active Stripe product named Pro");
  return product;
}

async function discoverPriceId(interval: BillingInterval): Promise<string> {
  const stripe = getStripe();
  const byKey = await stripe.prices.list({
    active: true,
    lookup_keys: [PRICE_LOOKUP_KEYS[interval]],
    type: "recurring",
    limit: 10,
  });
  const keyed = byKey.data.find(
    (price) => price.recurring?.interval === interval,
  );
  if (keyed) return keyed.id;

  const product = await findProProduct(stripe);
  const prices = await stripe.prices.list({
    active: true,
    product: product.id,
    type: "recurring",
    limit: 100,
  });
  const expectedAmount = interval === "month" ? 2900 : 24900;
  const candidates = prices.data.filter(
    (price) => price.recurring?.interval === interval,
  );
  const fallback =
    candidates.find(
      (price) => price.currency === "usd" && price.unit_amount === expectedAmount,
    ) ?? candidates[0];
  if (!fallback) {
    throw new Error(`No active ${interval} recurring price on the Pro product`);
  }
  return fallback.id;
}

export function priceIdFor(interval: BillingInterval): Promise<string> {
  const cached = priceCache.get(interval);
  if (cached) return cached;
  const request = discoverPriceId(interval).catch((error) => {
    priceCache.delete(interval);
    throw error;
  });
  priceCache.set(interval, request);
  return request;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
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

/** Only used by the local billing contract test. */
export function setStripeClientForTest(client: Stripe | null): void {
  stripeClient = client;
  priceCache.clear();
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
  promoCode?: string | null;
  referralCode?: string | null;
  referredByCode?: string | null;
  referredByUid?: string | null;
  referralCount?: number;
  referralRewardedAt?: number | null;
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

function newReferralCode(): string {
  return randomBytes(5)
    .toString("base64url")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toUpperCase();
}

async function userByReferralCode(
  code: string,
): Promise<{ uid: string; data: Record<string, unknown> } | null> {
  if (!isFirebaseConfigured()) return null;
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("users")
    .where("referralCode", "==", code.trim().toUpperCase())
    .limit(1)
    .get();
  const doc = snap.docs[0];
  return doc ? { uid: doc.id, data: doc.data() ?? {} } : null;
}

export async function ensureReferralCode(uid: string): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  const db = getFirebaseAdmin().firestore();
  const ref = db.collection("users").doc(uid);
  const user = await ref.get();
  const current = user.data()?.referralCode;
  if (typeof current === "string" && current) return current;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newReferralCode();
    if (await userByReferralCode(code)) continue;
    await ref.set({ referralCode: code, referralCount: 0 }, { merge: true });
    return code;
  }
  throw new Error("Could not allocate a referral code");
}

export async function referralSummary(uid: string): Promise<{
  code: string;
  count: number;
} | null> {
  if (!isFirebaseConfigured()) return null;
  const ref = getFirebaseAdmin().firestore().collection("users").doc(uid);
  const snap = await ref.get();
  const data = snap.data();
  if (
    !data ||
    !hasProAccess({
      plan: typeof data.plan === "string" ? data.plan : null,
      subscriptionStatus:
        typeof data.subscriptionStatus === "string"
          ? data.subscriptionStatus
          : null,
    })
  ) {
    return null;
  }
  const code = await ensureReferralCode(uid);
  if (!code) return null;
  return {
    code,
    count: typeof data.referralCount === "number" ? data.referralCount : 0,
  };
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

async function findPromotionCode(code: string): Promise<Stripe.PromotionCode | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const result = await getStripe().promotionCodes.list({
    active: true,
    code: normalized,
    limit: 10,
  });
  return (
    result.data.find(
      (promotion) => promotion.code.toUpperCase() === normalized,
    ) ?? null
  );
}

async function attachReferral(opts: {
  uid: string;
  referralCode?: string | null;
}): Promise<void> {
  const code = opts.referralCode?.trim().toUpperCase();
  if (!code || !isFirebaseConfigured()) return;
  const referrer = await userByReferralCode(code);
  if (!referrer || referrer.uid === opts.uid) return;
  await upsertBillingOnUser(opts.uid, {
    referredByCode: code,
    referredByUid: referrer.uid,
  });
}

export async function createCheckoutSession(opts: {
  uid: string;
  email?: string;
  stripeCustomerId?: string | null;
  stripeCustomerIdTest?: string | null;
  stripeCustomerIdLive?: string | null;
  interval: BillingInterval;
  promoCode?: string | null;
  referralCode?: string | null;
}): Promise<{ url: string }> {
  const stripe = getStripe();
  await attachReferral({
    uid: opts.uid,
    referralCode: opts.referralCode,
  });
  const customerId = await ensureStripeCustomer({
    uid: opts.uid,
    email: opts.email,
    stripeCustomerId: opts.stripeCustomerId,
    stripeCustomerIdTest: opts.stripeCustomerIdTest,
    stripeCustomerIdLive: opts.stripeCustomerIdLive,
  });
  const promotion =
    opts.interval === "month" &&
    opts.promoCode?.trim().toUpperCase() === FOUNDING_PROMO_CODE
      ? await findPromotionCode(FOUNDING_PROMO_CODE)
      : null;
  if (
    opts.interval === "month" &&
    opts.promoCode?.trim().toUpperCase() === FOUNDING_PROMO_CODE &&
    !promotion
  ) {
    throw new Error("Promotion code is not active");
  }

  const promoCode = promotion?.code.toUpperCase() ?? null;
  const discountOptions = promotion
    ? { discounts: [{ promotion_code: promotion.id }] }
    : { allow_promotion_codes: true };

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: opts.uid,
    line_items: [{ price: await priceIdFor(opts.interval), quantity: 1 }],
    success_url: `${appBaseUrl()}/activity?billing=success`,
    cancel_url: `${appBaseUrl()}/profile?billing=canceled`,
    ...discountOptions,
    payment_method_collection: "always",
    subscription_data: {
      trial_period_days: PRO_TRIAL_DAYS,
      metadata: {
        firebaseUid: opts.uid,
        plan: "pro",
        interval: opts.interval,
        ...(promoCode ? { promoCode } : {}),
      },
    },
    metadata: {
      firebaseUid: opts.uid,
      plan: "pro",
      interval: opts.interval,
      ...(promoCode ? { promoCode } : {}),
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

function promotionCodeName(
  promotion: string | Stripe.PromotionCode | null,
): string | null {
  return promotion && typeof promotion !== "string"
    ? promotion.code.toUpperCase()
    : null;
}

function promoCodeFromSubscription(
  subscription: Stripe.Subscription,
): string | null {
  const metadataCode = subscription.metadata?.promoCode;
  if (metadataCode) return metadataCode.toUpperCase();
  for (const discount of subscription.discounts) {
    if (typeof discount === "string") continue;
    const code = promotionCodeName(discount.promotion_code);
    if (code) return code;
  }
  return null;
}

function promoCodeFromSession(session: Stripe.Checkout.Session): string | null {
  const metadataCode = session.metadata?.promoCode;
  if (metadataCode) return metadataCode.toUpperCase();
  for (const discount of session.discounts ?? []) {
    const code = promotionCodeName(discount.promotion_code);
    if (code) return code;
  }
  return null;
}

function customerIdOf(subscription: Stripe.Subscription): string | null {
  if (typeof subscription.customer === "string") return subscription.customer;
  return subscription.customer?.id ?? null;
}

async function applySubscription(
  subscription: Stripe.Subscription,
  fallbackUid?: string,
  fallbackPromoCode?: string | null,
): Promise<void> {
  const uid = await resolveUidFromSubscription(subscription, fallbackUid);
  if (!uid) {
    console.warn("[billing] No firebaseUid on subscription", subscription.id);
    return;
  }

  const status = statusFromStripe(subscription.status);
  const paid = status === "active" || status === "trialing" || status === "past_due";
  const customerId = customerIdOf(subscription);
  const promoCode = promoCodeFromSubscription(subscription) ?? fallbackPromoCode;
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
    ...(promoCode
      ? { promoCode: promoCode.toUpperCase() }
      : {}),
    ...(paid && status !== "past_due" ? { paymentFailedAt: null } : {}),
  });
  if (paid) await ensureReferralCode(uid);
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const details = invoice.parent?.subscription_details;
  if (!details) return null;
  const sub = details.subscription;
  return typeof sub === "string" ? sub : sub?.id ?? null;
}

async function findReferralCoupon(): Promise<Stripe.Coupon> {
  const coupons = await getStripe().coupons.list({ limit: 100 });
  const eligible = coupons.data.filter(
    (item) =>
      item.valid && item.duration === "once" && item.percent_off === 100,
  );
  const coupon =
    eligible.find((item) => /referr/i.test(item.name ?? "")) ??
    (eligible.length === 1 ? eligible[0] : null);
  if (!coupon) {
    throw new Error("Could not uniquely identify the 100%-off-once referral coupon");
  }
  return coupon;
}

function existingDiscountParams(
  subscription: Stripe.Subscription,
): Array<{ coupon?: string; promotion_code?: string }> {
  const params: Array<{ coupon?: string; promotion_code?: string }> = [];
  for (const discount of subscription.discounts) {
    if (typeof discount === "string") continue;
    if (discount.promotion_code) {
      params.push({
        promotion_code:
          typeof discount.promotion_code === "string"
            ? discount.promotion_code
            : discount.promotion_code.id,
      });
      continue;
    }
    const coupon = discount.source.coupon;
    const couponId = typeof coupon === "string" ? coupon : coupon?.id;
    if (couponId) params.push({ coupon: couponId });
  }
  return params;
}

async function rewardReferrerForPaidConversion(
  referredSubscription: Stripe.Subscription,
): Promise<void> {
  if (!isFirebaseConfigured()) return;
  const referredUid = await resolveUidFromSubscription(referredSubscription);
  if (!referredUid) return;

  const db = getFirebaseAdmin().firestore();
  const referredRef = db.collection("users").doc(referredUid);
  const rewardRef = db.collection("referralRewards").doc(referredUid);
  const referred = (await referredRef.get()).data();
  const referrerUid =
    typeof referred?.referredByUid === "string"
      ? referred.referredByUid
      : null;
  if (!referrerUid || referrerUid === referredUid) return;

  const shouldProcess = await db.runTransaction(async (transaction) => {
    const reward = await transaction.get(rewardRef);
    const data = reward.data();
    if (data?.status === "completed") return false;
    if (
      data?.status === "processing" &&
      typeof data.startedAt === "number" &&
      Date.now() - data.startedAt < 5 * 60 * 1000
    ) {
      return false;
    }
    transaction.set(rewardRef, {
      referredUid,
      referrerUid,
      status: "processing",
      startedAt: Date.now(),
    });
    return true;
  });
  if (!shouldProcess) return;

  try {
    const referrerRef = db.collection("users").doc(referrerUid);
    const referrer = (await referrerRef.get()).data();
    const referrerSubscriptionId =
      typeof referrer?.stripeSubscriptionId === "string"
        ? referrer.stripeSubscriptionId
        : null;
    if (!referrerSubscriptionId) {
      throw new Error("Referrer has no active subscription");
    }

    const stripe = getStripe();
    const [subscription, coupon] = await Promise.all([
      stripe.subscriptions.retrieve(referrerSubscriptionId, {
        expand: ["discounts", "discounts.promotion_code"],
      }),
      findReferralCoupon(),
    ]);
    const discounts = existingDiscountParams(subscription);
    if (!discounts.some((item) => item.coupon === coupon.id)) {
      discounts.push({ coupon: coupon.id });
      await stripe.subscriptions.update(referrerSubscriptionId, { discounts });
    }

    await db.runTransaction(async (transaction) => {
      transaction.set(
        rewardRef,
        {
          status: "completed",
          completedAt: Date.now(),
          couponId: coupon.id,
          referrerSubscriptionId,
        },
        { merge: true },
      );
      transaction.set(
        referredRef,
        { referralRewardedAt: Date.now() },
        { merge: true },
      );
      transaction.set(
        referrerRef,
        {
          referralCount:
            FieldValue.increment(1),
        },
        { merge: true },
      );
    });
  } catch (error) {
    await rewardRef.set(
      {
        status: "failed",
        failedAt: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { merge: true },
    );
    throw error;
  }
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
      const eventSession = event.data.object as Stripe.Checkout.Session;
      const session = await stripe.checkout.sessions.retrieve(eventSession.id, {
        expand: ["discounts.promotion_code"],
      });
      const uid = session.client_reference_id || session.metadata?.firebaseUid;
      if (!uid || session.mode !== "subscription") break;

      const subId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (!subId) break;

      const subscription = await stripe.subscriptions.retrieve(subId, {
        expand: ["discounts", "discounts.promotion_code"],
      });
      await applySubscription(subscription, uid, promoCodeFromSession(session));
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
        billingInterval: intervalOf(subscription),
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
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      if (
        invoice.amount_paid <= 0 ||
        invoice.billing_reason !== "subscription_cycle"
      ) {
        break;
      }
      const subId = subscriptionIdFromInvoice(invoice);
      if (!subId) break;
      const subscription = await stripe.subscriptions.retrieve(subId, {
        expand: ["discounts", "discounts.promotion_code"],
      });
      await applySubscription(subscription);
      await rewardReferrerForPaidConversion(subscription);
      break;
    }
    default:
      break;
  }
}
