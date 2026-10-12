import Stripe from "stripe";
import {
  FOUNDING_PROMO_CODE,
  TEAM_SEATS,
  hasProAccess,
  isPaidPlan,
  lookupKeyForCheckoutPlan,
  normalizePlan,
  PRO_TRIAL_DAYS,
  type BillingInterval,
  type CheckoutPlan,
  type PlanTier,
  type SubscriptionStatus,
} from "@nearby/shared";
import { notifyPaymentFailed } from "./emails.js";
import { getFirebaseAdmin, isFirebaseConfigured } from "./firebase.js";

let stripeClient: Stripe | null = null;

const REFERRAL_COUPON_ID = "referral_free_month";
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
const priceCache = new Map<string, { id: string; expiresAt: number }>();

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

export function teamPriceId(): string | null {
  return process.env.STRIPE_PRICE_ID_TEAM_MONTHLY?.trim() || null;
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
  seats?: number | null;
  teamMemberEmails?: string[];
  teamOwnerId?: string | null;
  referralCode?: string | null;
  referralCount?: number;
  referredBy?: string | null;
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

function lookupKeyOf(subscription: Stripe.Subscription): string | null {
  const key = subscription.items?.data?.[0]?.price?.lookup_key;
  return typeof key === "string" && key ? key : null;
}

function planFromSubscription(
  subscription: Stripe.Subscription,
  fallback?: CheckoutPlan | string | null,
): PlanTier {
  const key =
    lookupKeyOf(subscription) ||
    subscription.metadata?.nearby_plan ||
    subscription.metadata?.plan ||
    fallback ||
    "";
  if (key === "pro_annual" || key === "year") return "pro_annual";
  if (key === "team_monthly" || key === "team") return "team";
  if (key === "pro_monthly" || key === "month" || key === "pro") {
    return "pro_monthly";
  }
  const interval = intervalOf(subscription);
  if (interval === "year") return "pro_annual";
  return "pro_monthly";
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

export async function priceIdForCheckoutPlan(
  plan: CheckoutPlan,
): Promise<string> {
  const lookupKey = lookupKeyForCheckoutPlan(plan);
  const cached = priceCache.get(lookupKey);
  if (cached && cached.expiresAt > Date.now()) return cached.id;

  const stripe = getStripe();
  const listed = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  const found = listed.data[0];
  if (found) {
    priceCache.set(lookupKey, {
      id: found.id,
      expiresAt: Date.now() + PRICE_CACHE_TTL_MS,
    });
    return found.id;
  }

  const fallback =
    plan === "pro_annual"
      ? yearlyPriceId()
      : plan === "team"
        ? teamPriceId()
        : monthlyPriceId();
  if (!fallback) {
    throw new Error(
      `No Stripe price for ${lookupKey}. Run pnpm stripe:setup or set the env fallback.`,
    );
  }
  priceCache.set(lookupKey, {
    id: fallback,
    expiresAt: Date.now() + PRICE_CACHE_TTL_MS,
  });
  return fallback;
}

/** @deprecated Prefer priceIdForCheckoutPlan. */
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

export async function resolvePromotionCodeId(
  code: string,
): Promise<{ id: string; code: string } | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const stripe = getStripe();
  const listed = await stripe.promotionCodes.list({
    code: normalized,
    active: true,
    limit: 5,
  });
  const match = listed.data.find(
    (row) => row.code.toUpperCase() === normalized && row.active,
  );
  if (!match) return null;
  return { id: match.id, code: match.code };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function randomReferralCode(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  }
  return out;
}

async function ensureReferralCode(uid: string): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  const ref = getFirebaseAdmin().firestore().collection("users").doc(uid);
  const snap = await ref.get();
  const existing = snap.data()?.referralCode;
  if (typeof existing === "string" && existing.trim()) return existing.trim();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomReferralCode();
    const clash = await getFirebaseAdmin()
      .firestore()
      .collection("users")
      .where("referralCode", "==", code)
      .limit(1)
      .get();
    if (clash.docs.length > 0) continue;
    await upsertBillingOnUser(uid, { referralCode: code });
    return code;
  }
  return null;
}

export async function createCheckoutSession(opts: {
  uid: string;
  email?: string;
  stripeCustomerId?: string | null;
  stripeCustomerIdTest?: string | null;
  stripeCustomerIdLive?: string | null;
  plan: CheckoutPlan;
  /** Legacy alias — mapped to plan when plan omitted by callers. */
  interval?: BillingInterval;
  promoCode?: string | null;
  referredBy?: string | null;
}): Promise<{ url: string }> {
  const stripe = getStripe();
  const plan: CheckoutPlan =
    opts.plan ??
    (opts.interval === "year" ? "pro_annual" : "pro_monthly");
  const customerId = await ensureStripeCustomer({
    uid: opts.uid,
    email: opts.email,
    stripeCustomerId: opts.stripeCustomerId,
    stripeCustomerIdTest: opts.stripeCustomerIdTest,
    stripeCustomerIdLive: opts.stripeCustomerIdLive,
  });

  const priceId = await priceIdForCheckoutPlan(plan);
  const interval: BillingInterval =
    plan === "pro_annual" ? "year" : "month";

  const promo =
    opts.promoCode && plan === "pro_monthly"
      ? await resolvePromotionCodeId(opts.promoCode)
      : opts.promoCode
        ? await resolvePromotionCodeId(opts.promoCode)
        : null;

  // Stripe forbids allow_promotion_codes together with discounts.
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: customerId,
    client_reference_id: opts.uid,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appBaseUrl()}/activity?billing=success`,
    cancel_url: `${appBaseUrl()}/profile?billing=canceled`,
    payment_method_collection: "always",
    subscription_data: {
      trial_period_days: PRO_TRIAL_DAYS,
      metadata: {
        firebaseUid: opts.uid,
        plan,
        nearby_plan: plan,
        interval,
        ...(opts.referredBy ? { referredBy: opts.referredBy } : {}),
        ...(promo ? { promoCode: promo.code } : {}),
        ...(plan === "team" ? { seats: String(TEAM_SEATS) } : {}),
      },
    },
    metadata: {
      firebaseUid: opts.uid,
      plan,
      nearby_plan: plan,
      interval,
      ...(opts.referredBy ? { referredBy: opts.referredBy } : {}),
      ...(promo ? { promoCode: promo.code } : {}),
    },
  };

  if (promo) {
    sessionParams.discounts = [{ promotion_code: promo.id }];
  } else {
    sessionParams.allow_promotion_codes = true;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

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

async function readUserData(
  uid: string,
): Promise<Record<string, unknown> | null> {
  if (!isFirebaseConfigured()) return null;
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("users")
    .doc(uid)
    .get();
  return snap.exists ? (snap.data() ?? null) : null;
}

async function findUidByReferralCode(code: string): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  const snap = await getFirebaseAdmin()
    .firestore()
    .collection("users")
    .where("referralCode", "==", code)
    .limit(1)
    .get();
  return snap.docs[0]?.id ?? null;
}

async function promoCodeFromSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<string | null> {
  if (session.metadata?.promoCode) return session.metadata.promoCode;
  try {
    const full = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["total_details.breakdown.discounts"],
    });
    const discounts = full.total_details?.breakdown?.discounts ?? [];
    for (const row of discounts) {
      const discount = row.discount;
      if (!discount) continue;
      const promo = discount.promotion_code;
      if (typeof promo === "string") {
        const retrieved = await stripe.promotionCodes.retrieve(promo);
        return retrieved.code;
      }
      if (promo && typeof promo === "object" && "code" in promo) {
        return (promo as Stripe.PromotionCode).code;
      }
      const sourceCoupon = discount.source?.coupon;
      const couponName =
        sourceCoupon &&
        typeof sourceCoupon === "object" &&
        "name" in sourceCoupon
          ? sourceCoupon.name
          : null;
      if (couponName === "Founding Member") {
        return FOUNDING_PROMO_CODE;
      }
    }
  } catch (err) {
    console.warn("[billing] could not expand session discounts", err);
  }
  return null;
}

async function rewardReferrer(referrerUid: string): Promise<void> {
  if (!isFirebaseConfigured()) return;
  const data = await readUserData(referrerUid);
  if (!data) return;
  const subId =
    typeof data.stripeSubscriptionId === "string"
      ? data.stripeSubscriptionId
      : null;
  if (!subId) {
    console.warn("[billing] referrer has no subscription to discount", referrerUid);
    return;
  }

  const stripe = getStripe();
  try {
    await stripe.subscriptions.update(subId, {
      discounts: [{ coupon: REFERRAL_COUPON_ID }],
    });
  } catch (err) {
    console.error("[billing] failed to apply referral coupon", err);
    return;
  }

  const prev =
    typeof data.referralCount === "number" && Number.isFinite(data.referralCount)
      ? data.referralCount
      : 0;
  await upsertBillingOnUser(referrerUid, { referralCount: prev + 1 });
}

async function maybeRewardReferralOnConversion(
  uid: string,
  subscription: Stripe.Subscription,
  previousStatus?: string | null,
): Promise<void> {
  const status = statusFromStripe(subscription.status);
  if (status !== "active") return;
  if (previousStatus && previousStatus !== "trialing") return;

  const data = await readUserData(uid);
  const referredBy =
    (typeof data?.referredBy === "string" && data.referredBy) ||
    subscription.metadata?.referredBy ||
    null;
  if (!referredBy) return;

  // Only reward once per referred user.
  if (data?.referralRewardedAt) return;

  const referrerUid = await findUidByReferralCode(referredBy);
  if (!referrerUid || referrerUid === uid) return;

  await rewardReferrer(referrerUid);
  if (isFirebaseConfigured()) {
    await getFirebaseAdmin()
      .firestore()
      .collection("users")
      .doc(uid)
      .set(
        { referralRewardedAt: Date.now(), updatedAt: Date.now() },
        { merge: true },
      );
  }
}

async function clearTeamMembers(ownerId: string): Promise<void> {
  if (!isFirebaseConfigured()) return;
  const data = await readUserData(ownerId);
  const emails = Array.isArray(data?.teamMemberEmails)
    ? data!.teamMemberEmails.map(String)
    : [];
  const db = getFirebaseAdmin().firestore();

  for (const email of emails) {
    const inviteRef = db.collection("teamInvites").doc(normalizeEmail(email));
    await inviteRef.delete().catch(() => undefined);
  }

  const members = await db
    .collection("users")
    .where("teamOwnerId", "==", ownerId)
    .get();
  for (const doc of members.docs) {
    await upsertBillingOnUser(doc.id, {
      plan: "free",
      subscriptionStatus: "none",
      teamOwnerId: null,
      stripeSubscriptionId: null,
      trialEndsAt: null,
      billingInterval: null,
      seats: null,
    });
  }

  await upsertBillingOnUser(ownerId, {
    teamMemberEmails: [],
    seats: null,
  });
}

async function applySubscription(
  subscription: Stripe.Subscription,
  fallbackUid?: string,
  extras?: { promoCode?: string | null; previousStatus?: string | null },
): Promise<void> {
  const uid = await resolveUidFromSubscription(subscription, fallbackUid);
  if (!uid) {
    console.warn("[billing] No firebaseUid on subscription", subscription.id);
    return;
  }

  const status = statusFromStripe(subscription.status);
  const paid = status === "active" || status === "trialing" || status === "past_due";
  const customerId = customerIdOf(subscription);
  const plan = paid
    ? planFromSubscription(subscription)
    : ("free" as PlanTier);

  const patch: BillingPatch = {
    plan: paid ? plan : "free",
    subscriptionStatus: status,
    ...(customerId ? customerIdPatch(customerId) : { stripeCustomerId: null }),
    stripeSubscriptionId: paid ? subscription.id : null,
    trialEndsAt:
      typeof subscription.trial_end === "number"
        ? subscription.trial_end * 1000
        : null,
    currentPeriodEnd: periodEndMs(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    billingInterval: paid ? intervalOf(subscription) : null,
    ...(paid && status !== "past_due" ? { paymentFailedAt: null } : {}),
  };

  if (extras?.promoCode) patch.promoCode = extras.promoCode;
  else if (subscription.metadata?.promoCode) {
    patch.promoCode = subscription.metadata.promoCode;
  }

  if (paid && plan === "team") {
    patch.seats = TEAM_SEATS;
  } else if (!paid) {
    patch.seats = null;
  }

  await upsertBillingOnUser(uid, patch);

  if (paid) {
    await ensureReferralCode(uid);
  }

  if (paid && status === "active") {
    await maybeRewardReferralOnConversion(
      uid,
      subscription,
      extras?.previousStatus,
    );
  }

  if (!paid) {
    const prior = await readUserData(uid);
    if (normalizePlan(prior?.plan) === "team" || prior?.seats) {
      await clearTeamMembers(uid);
    }
  }
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
      const promoCode = await promoCodeFromSession(stripe, session);
      await applySubscription(subscription, uid, { promoCode });
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const subscription = event.data.object as Stripe.Subscription;
      const prev = (
        event.data as {
          previous_attributes?: { status?: string };
        }
      ).previous_attributes;
      await applySubscription(subscription, undefined, {
        previousStatus: prev?.status ?? null,
      });
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
      const wasTeam =
        planFromSubscription(subscription) === "team" ||
        normalizePlan((await readUserData(uid))?.plan) === "team";
      await upsertBillingOnUser(uid, {
        plan: "free",
        subscriptionStatus: "canceled",
        ...(customerId ? customerIdPatch(customerId) : { stripeCustomerId: null }),
        stripeSubscriptionId: null,
        trialEndsAt: null,
        currentPeriodEnd: periodEndMs(subscription),
        cancelAtPeriodEnd: false,
        billingInterval: null,
        seats: null,
      });
      if (wasTeam) await clearTeamMembers(uid);
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
          plan: planFromSubscription(subscription),
          subscriptionStatus: statusFromStripe(subscription.status),
        })
          ? planFromSubscription(subscription)
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

// ——— Team seats ———

export async function listTeamState(ownerId: string): Promise<{
  seats: number;
  memberEmails: string[];
  remaining: number;
}> {
  const data = await readUserData(ownerId);
  const emails = Array.isArray(data?.teamMemberEmails)
    ? data!.teamMemberEmails.map((e) => normalizeEmail(String(e)))
    : [];
  const seats =
    typeof data?.seats === "number" && data.seats > 0 ? data.seats : TEAM_SEATS;
  return {
    seats,
    memberEmails: emails,
    remaining: Math.max(0, seats - 1 - emails.length),
  };
}

export async function inviteTeamMember(
  ownerId: string,
  emailRaw: string,
): Promise<{ memberEmails: string[] }> {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is required for team invites");
  }
  const owner = await readUserData(ownerId);
  if (!owner || normalizePlan(owner.plan) !== "team" || !hasProAccess({
    plan: owner.plan as string,
    subscriptionStatus: owner.subscriptionStatus as string,
  })) {
    throw new Error("Team plan required to invite");
  }

  const email = normalizeEmail(emailRaw);
  if (!email || !email.includes("@")) throw new Error("Enter a valid email");

  const state = await listTeamState(ownerId);
  if (state.memberEmails.includes(email)) {
    return { memberEmails: state.memberEmails };
  }
  if (state.memberEmails.length >= state.seats - 1) {
    throw new Error(`Team is full (${state.seats - 1} invites max)`);
  }

  const next = [...state.memberEmails, email];
  const db = getFirebaseAdmin().firestore();
  await db.collection("teamInvites").doc(email).set({
    ownerId,
    email,
    createdAt: Date.now(),
  });
  await upsertBillingOnUser(ownerId, { teamMemberEmails: next, seats: state.seats });

  const users = await db
    .collection("users")
    .where("email", "==", email)
    .limit(5)
    .get();
  // Also try case variants already normalized on write.
  for (const doc of users.docs) {
    if (doc.id === ownerId) continue;
    await upsertBillingOnUser(doc.id, {
      plan: "team_member",
      subscriptionStatus: "active",
      teamOwnerId: ownerId,
    });
  }

  return { memberEmails: next };
}

export async function removeTeamMember(
  ownerId: string,
  emailRaw: string,
): Promise<{ memberEmails: string[] }> {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is required for team invites");
  }
  const email = normalizeEmail(emailRaw);
  const state = await listTeamState(ownerId);
  const next = state.memberEmails.filter((e) => e !== email);
  const db = getFirebaseAdmin().firestore();
  await db.collection("teamInvites").doc(email).delete().catch(() => undefined);
  await upsertBillingOnUser(ownerId, { teamMemberEmails: next });

  const users = await db
    .collection("users")
    .where("email", "==", email)
    .limit(5)
    .get();
  for (const doc of users.docs) {
    const data = doc.data();
    if (data?.teamOwnerId === ownerId) {
      await upsertBillingOnUser(doc.id, {
        plan: "free",
        subscriptionStatus: "none",
        teamOwnerId: null,
      });
    }
  }

  return { memberEmails: next };
}

/** Grant team_member access when an invited email signs in. */
export async function syncTeamMembershipForUser(opts: {
  uid: string;
  email?: string | null;
}): Promise<boolean> {
  if (!isFirebaseConfigured() || !opts.email) return false;
  const email = normalizeEmail(opts.email);
  const invite = await getFirebaseAdmin()
    .firestore()
    .collection("teamInvites")
    .doc(email)
    .get();
  if (!invite.exists) return false;
  const ownerId = String(invite.data()?.ownerId ?? "");
  if (!ownerId || ownerId === opts.uid) return false;

  const owner = await readUserData(ownerId);
  if (
    !owner ||
    normalizePlan(owner.plan) !== "team" ||
    !hasProAccess({
      plan: owner.plan as string,
      subscriptionStatus: owner.subscriptionStatus as string,
    })
  ) {
    return false;
  }

  await upsertBillingOnUser(opts.uid, {
    plan: "team_member",
    subscriptionStatus: "active",
    teamOwnerId: ownerId,
  });
  return true;
}

export async function getReferralInfo(uid: string): Promise<{
  code: string | null;
  count: number;
  url: string | null;
}> {
  const data = await readUserData(uid);
  let code =
    typeof data?.referralCode === "string" ? data.referralCode : null;
  if (!code && data && isPaidPlan(data.plan) && hasProAccess({
    plan: data.plan as string,
    subscriptionStatus: data.subscriptionStatus as string,
  })) {
    code = await ensureReferralCode(uid);
  }
  const count =
    typeof data?.referralCount === "number" ? data.referralCount : 0;
  return {
    code,
    count,
    url: code ? `${appBaseUrl()}/r/${code}` : null,
  };
}

export { isPaidPlan };
