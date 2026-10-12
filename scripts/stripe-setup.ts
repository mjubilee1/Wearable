/**
 * Idempotent Stripe catalog setup for Nearby (TEST or LIVE — whatever
 * STRIPE_SECRET_KEY points at). Uses lookup_keys so reruns do not duplicate.
 *
 *   pnpm stripe:setup
 *
 * Prints price IDs and the FOUNDING19 promotion code ID.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
loadEnv({ path: resolve(root, "apps/api/.env") });
loadEnv({ path: resolve(root, ".env") });

const LOOKUP = {
  proMonthly: "pro_monthly",
  proAnnual: "pro_annual",
  teamMonthly: "team_monthly",
} as const;

const FOUNDING_COUPON_ID = "founding_member";
const FOUNDING_PROMO = "FOUNDING19";
const REFERRAL_COUPON_ID = "referral_free_month";

function requireKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  if (!key.includes("_test_")) {
    console.warn(
      "[stripe-setup] WARNING: key does not look like test mode. Aborting unless ALLOW_LIVE_STRIPE=1.",
    );
    if (process.env.ALLOW_LIVE_STRIPE !== "1") {
      throw new Error(
        "Refusing to run against a non-test key. Set ALLOW_LIVE_STRIPE=1 after confirming test results.",
      );
    }
  }
  return key;
}

async function priceByLookup(
  stripe: Stripe,
  lookupKey: string,
): Promise<Stripe.Price | null> {
  const list = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  return list.data[0] ?? null;
}

async function ensureProProduct(stripe: Stripe): Promise<Stripe.Product> {
  const existing = await priceByLookup(stripe, LOOKUP.proMonthly);
  if (existing && typeof existing.product === "string") {
    return stripe.products.retrieve(existing.product);
  }
  if (existing && typeof existing.product === "object") {
    return existing.product as Stripe.Product;
  }

  const listed = await stripe.products.list({ active: true, limit: 100 });
  const named = listed.data.find(
    (p) =>
      p.name === "Nearby Pro" ||
      p.metadata?.nearby_plan === "pro" ||
      p.metadata?.plan === "pro",
  );
  if (named) return named;

  return stripe.products.create({
    name: "Nearby Pro",
    description: "Unlimited requests, reschedules, and email drafts.",
    metadata: { nearby_plan: "pro" },
  });
}

async function ensureTeamProduct(stripe: Stripe): Promise<Stripe.Product> {
  const existing = await priceByLookup(stripe, LOOKUP.teamMonthly);
  if (existing && typeof existing.product === "string") {
    return stripe.products.retrieve(existing.product);
  }
  if (existing && typeof existing.product === "object") {
    return existing.product as Stripe.Product;
  }

  const listed = await stripe.products.list({ active: true, limit: 100 });
  const named = listed.data.find(
    (p) =>
      p.name === "Nearby Team" ||
      p.metadata?.nearby_plan === "team" ||
      p.metadata?.plan === "team",
  );
  if (named) return named;

  return stripe.products.create({
    name: "Nearby Team",
    description: "Pro for a team of 10 seats.",
    metadata: { nearby_plan: "team", seats: "10" },
  });
}

async function ensureRecurringPrice(
  stripe: Stripe,
  opts: {
    productId: string;
    lookupKey: string;
    unitAmount: number;
    interval: "month" | "year";
    nickname: string;
    metadata?: Record<string, string>;
  },
): Promise<Stripe.Price> {
  const existing = await priceByLookup(stripe, opts.lookupKey);
  if (existing) {
    if (
      existing.unit_amount === opts.unitAmount &&
      existing.recurring?.interval === opts.interval &&
      (typeof existing.product === "string"
        ? existing.product === opts.productId
        : existing.product.id === opts.productId)
    ) {
      return existing;
    }
    console.warn(
      `[stripe-setup] lookup_key ${opts.lookupKey} exists but does not match expected amount/interval; leaving it.`,
    );
    return existing;
  }

  return stripe.prices.create({
    product: opts.productId,
    currency: "usd",
    unit_amount: opts.unitAmount,
    recurring: { interval: opts.interval },
    lookup_key: opts.lookupKey,
    transfer_lookup_key: true,
    nickname: opts.nickname,
    metadata: opts.metadata,
  });
}

/** Deactivate old $290/yr Pro prices so checkout only offers $249. */
async function deactivateLegacyAnnual(
  stripe: Stripe,
  proProductId: string,
  keepPriceId: string,
): Promise<string[]> {
  const deactivated: string[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.prices.list({
      product: proProductId,
      active: true,
      limit: 100,
      starting_after: startingAfter,
    });
    for (const price of page.data) {
      if (price.id === keepPriceId) continue;
      if (price.lookup_key === LOOKUP.proAnnual) continue;
      const isLegacyYearly =
        price.recurring?.interval === "year" &&
        (price.unit_amount === 29000 ||
          price.lookup_key === "pro_yearly" ||
          price.nickname?.toLowerCase().includes("290"));
      if (!isLegacyYearly) continue;
      await stripe.prices.update(price.id, { active: false });
      deactivated.push(price.id);
    }
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) break;
  }
  return deactivated;
}

async function ensureFoundingCoupon(
  stripe: Stripe,
  proProductId: string,
): Promise<Stripe.Coupon> {
  try {
    const existing = await stripe.coupons.retrieve(FOUNDING_COUPON_ID);
    return existing;
  } catch {
    // create below
  }

  return stripe.coupons.create({
    id: FOUNDING_COUPON_ID,
    name: "Founding Member",
    amount_off: 1000,
    currency: "usd",
    duration: "forever",
    max_redemptions: 20,
    applies_to: { products: [proProductId] },
    metadata: { nearby: "founding", applies_to_lookup: LOOKUP.proMonthly },
  });
}

function promoCouponId(promo: Stripe.PromotionCode): string | null {
  const coupon = promo.promotion?.coupon;
  if (typeof coupon === "string") return coupon;
  if (coupon && typeof coupon === "object" && "id" in coupon) return coupon.id;
  return null;
}

async function ensureFoundingPromo(
  stripe: Stripe,
  couponId: string,
): Promise<Stripe.PromotionCode> {
  const listed = await stripe.promotionCodes.list({
    code: FOUNDING_PROMO,
    limit: 10,
  });
  const match = listed.data.find(
    (p) => promoCouponId(p) === couponId || p.code === FOUNDING_PROMO,
  );
  if (match) return match;

  return stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: couponId },
    code: FOUNDING_PROMO,
    active: true,
    metadata: { nearby: "founding" },
  });
}

async function ensureReferralCoupon(stripe: Stripe): Promise<Stripe.Coupon> {
  try {
    return await stripe.coupons.retrieve(REFERRAL_COUPON_ID);
  } catch {
    // create below
  }
  return stripe.coupons.create({
    id: REFERRAL_COUPON_ID,
    name: "Referral free month",
    percent_off: 100,
    duration: "once",
    metadata: { nearby: "referral" },
  });
}

async function main() {
  const key = requireKey();
  const stripe = new Stripe(key);
  const mode = key.includes("_test_") ? "test" : "live";
  console.log(`[stripe-setup] mode=${mode}`);

  const pro = await ensureProProduct(stripe);
  const team = await ensureTeamProduct(stripe);
  console.log(`[stripe-setup] Pro product: ${pro.id}`);
  console.log(`[stripe-setup] Team product: ${team.id}`);

  const proMonthly = await ensureRecurringPrice(stripe, {
    productId: pro.id,
    lookupKey: LOOKUP.proMonthly,
    unitAmount: 2900,
    interval: "month",
    nickname: "Pro monthly",
    metadata: { nearby_plan: "pro_monthly" },
  });
  const proAnnual = await ensureRecurringPrice(stripe, {
    productId: pro.id,
    lookupKey: LOOKUP.proAnnual,
    unitAmount: 24900,
    interval: "year",
    nickname: "Pro annual",
    metadata: { nearby_plan: "pro_annual" },
  });
  const teamMonthly = await ensureRecurringPrice(stripe, {
    productId: team.id,
    lookupKey: LOOKUP.teamMonthly,
    unitAmount: 19900,
    interval: "month",
    nickname: "Team monthly",
    metadata: { nearby_plan: "team", seats: "10" },
  });

  const deactivated = await deactivateLegacyAnnual(
    stripe,
    pro.id,
    proAnnual.id,
  );
  if (deactivated.length) {
    console.log(
      `[stripe-setup] Deactivated legacy yearly prices: ${deactivated.join(", ")}`,
    );
  }

  const foundingCoupon = await ensureFoundingCoupon(stripe, pro.id);
  const foundingPromo = await ensureFoundingPromo(stripe, foundingCoupon.id);
  const referralCoupon = await ensureReferralCoupon(stripe);

  console.log("\n=== Nearby Stripe catalog ===");
  console.log(`pro_monthly price:     ${proMonthly.id}  (lookup_key=${LOOKUP.proMonthly})`);
  console.log(`pro_annual price:      ${proAnnual.id}  (lookup_key=${LOOKUP.proAnnual})`);
  console.log(`team_monthly price:    ${teamMonthly.id}  (lookup_key=${LOOKUP.teamMonthly})`);
  console.log(`Founding coupon:       ${foundingCoupon.id}`);
  console.log(`FOUNDING19 promo id:   ${foundingPromo.id}`);
  console.log(`Referral coupon:       ${referralCoupon.id}`);
  console.log("\nOptional env fallbacks (lookup_key is preferred at runtime):");
  console.log(`STRIPE_PRICE_ID_PRO_MONTHLY=${proMonthly.id}`);
  console.log(`STRIPE_PRICE_ID_PRO_YEARLY=${proAnnual.id}`);
  console.log(`STRIPE_PRICE_ID_TEAM_MONTHLY=${teamMonthly.id}`);
}

main().catch((err) => {
  console.error("[stripe-setup] failed", err);
  process.exit(1);
});
