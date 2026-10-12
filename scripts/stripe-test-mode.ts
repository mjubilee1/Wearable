/**
 * Stripe TEST-mode smoke tests for Nearby billing.
 *
 *   pnpm stripe:test
 *
 * Requires STRIPE_SECRET_KEY=sk_test_...
 * Runs catalog setup, then creates Checkout sessions for monthly / annual /
 * team / founding promo, advances a test clock for a referral conversion,
 * and opens a Customer Portal session (cancel path).
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import Stripe from "stripe";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
loadEnv({ path: resolve(root, "apps/api/.env") });
loadEnv({ path: resolve(root, ".env") });

type Result = { name: string; ok: boolean; detail: string };

function requireTestKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!key.includes("_test_")) {
    throw new Error("stripe-test-mode refuses non-test keys");
  }
  return key;
}

async function priceId(stripe: Stripe, lookupKey: string): Promise<string> {
  const list = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  const price = list.data[0];
  if (!price) throw new Error(`Missing price lookup_key=${lookupKey}`);
  return price.id;
}

async function promoId(stripe: Stripe, code: string): Promise<string> {
  const list = await stripe.promotionCodes.list({ code, active: true, limit: 5 });
  const match = list.data.find((p) => p.code.toUpperCase() === code.toUpperCase());
  if (!match) throw new Error(`Missing promotion code ${code}`);
  return match.id;
}

async function main() {
  const key = requireTestKey();
  const setup = spawnSync("pnpm", ["stripe:setup"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (setup.status !== 0) {
    console.error(setup.stdout);
    console.error(setup.stderr);
    throw new Error("stripe:setup failed");
  }
  console.log(setup.stdout);

  const stripe = new Stripe(key);
  const results: Result[] = [];
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "") || "http://localhost:3000";

  const proMonthly = await priceId(stripe, "pro_monthly");
  const proAnnual = await priceId(stripe, "pro_annual");
  const teamMonthly = await priceId(stripe, "team_monthly");
  const foundingPromo = await promoId(stripe, "FOUNDING19");

  async function checkout(
    name: string,
    opts: {
      price: string;
      discounts?: Stripe.Checkout.SessionCreateParams.Discount[];
      allowPromo?: boolean;
      metadata?: Record<string, string>;
    },
  ) {
    const customer = await stripe.customers.create({
      email: `test-${name.replace(/\s+/g, "-")}@nearby.test`,
      metadata: { nearby_test: name },
    });
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customer.id,
        line_items: [{ price: opts.price, quantity: 1 }],
        success_url: `${base}/activity?billing=success`,
        cancel_url: `${base}/profile?billing=canceled`,
        payment_method_collection: "always",
        ...(opts.discounts
          ? { discounts: opts.discounts }
          : { allow_promotion_codes: opts.allowPromo !== false }),
        subscription_data: {
          trial_period_days: 7,
          metadata: opts.metadata ?? { nearby_test: name },
        },
        metadata: opts.metadata ?? { nearby_test: name },
      });
      const ok = Boolean(session.url) && session.mode === "subscription";
      results.push({
        name,
        ok,
        detail: ok
          ? `session=${session.id} url=yes customer=${customer.id}`
          : "missing checkout url",
      });
      return { customer, session };
    } catch (err) {
      results.push({
        name,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
      return { customer, session: null };
    }
  }

  await checkout("monthly", {
    price: proMonthly,
    metadata: { plan: "pro_monthly" },
  });
  await checkout("annual", {
    price: proAnnual,
    metadata: { plan: "pro_annual" },
  });
  await checkout("team", {
    price: teamMonthly,
    metadata: { plan: "team", seats: "10" },
  });
  await checkout("promo FOUNDING19", {
    price: proMonthly,
    discounts: [{ promotion_code: foundingPromo }],
    metadata: { plan: "pro_monthly", promoCode: "FOUNDING19" },
  });

  // Referral conversion via test clock: referrer + referred trial → advance → active.
  try {
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000),
      name: "nearby-referral",
    });
    const referrer = await stripe.customers.create({
      email: "referrer@nearby.test",
      test_clock: clock.id,
      payment_method: "pm_card_visa",
      invoice_settings: { default_payment_method: "pm_card_visa" },
    });
    // Attach payment method for subscription charges after trial.
    await stripe.paymentMethods.attach("pm_card_visa", { customer: referrer.id }).catch(() => undefined);

    const referrerPm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" },
    });
    await stripe.paymentMethods.attach(referrerPm.id, { customer: referrer.id });
    await stripe.customers.update(referrer.id, {
      invoice_settings: { default_payment_method: referrerPm.id },
    });

    const referrerSub = await stripe.subscriptions.create({
      customer: referrer.id,
      items: [{ price: proMonthly }],
      trial_period_days: 7,
      default_payment_method: referrerPm.id,
      metadata: { nearby_test: "referrer", referralCode: "testref01" },
    });

    const referred = await stripe.customers.create({
      email: "referred@nearby.test",
      test_clock: clock.id,
    });
    const referredPm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" },
    });
    await stripe.paymentMethods.attach(referredPm.id, { customer: referred.id });
    await stripe.customers.update(referred.id, {
      invoice_settings: { default_payment_method: referredPm.id },
    });

    const referredSub = await stripe.subscriptions.create({
      customer: referred.id,
      items: [{ price: proMonthly }],
      trial_period_days: 7,
      default_payment_method: referredPm.id,
      metadata: { nearby_test: "referred", referredBy: "testref01" },
    });

    // Jump past trial.
    const advanceTo =
      (typeof referredSub.trial_end === "number"
        ? referredSub.trial_end
        : Math.floor(Date.now() / 1000)) + 60;
    await stripe.testHelpers.testClocks.advance(clock.id, {
      frozen_time: advanceTo,
    });

    // Poll until subscription leaves trialing.
    let converted = false;
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      const sub = await stripe.subscriptions.retrieve(referredSub.id);
      if (sub.status === "active") {
        converted = true;
        break;
      }
      if (sub.status !== "trialing") break;
    }

    // Apply referral reward coupon to referrer (mirrors webhook handler).
    let couponApplied = false;
    if (converted) {
      await stripe.subscriptions.update(referrerSub.id, {
        discounts: [{ coupon: "referral_free_month" }],
      });
      const updated = await stripe.subscriptions.retrieve(referrerSub.id, {
        expand: ["discounts"],
      });
      couponApplied = (updated.discounts?.length ?? 0) > 0 ||
        Boolean(
          // older shape
          (updated as { discount?: { coupon?: { id?: string } } }).discount?.coupon?.id,
        );
    }

    results.push({
      name: "referral conversion (test clock)",
      ok: converted && couponApplied,
      detail: `converted=${converted} couponApplied=${couponApplied} clock=${clock.id}`,
    });
  } catch (err) {
    results.push({
      name: "referral conversion (test clock)",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Customer Portal (cancel path).
  try {
    const customer = await stripe.customers.create({
      email: "portal@nearby.test",
      metadata: { nearby_test: "portal" },
    });
    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" },
    });
    await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: pm.id },
    });
    await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: proMonthly }],
      trial_period_days: 7,
      default_payment_method: pm.id,
    });
    const portal = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${base}/profile`,
    });
    results.push({
      name: "customer portal (cancel)",
      ok: Boolean(portal.url),
      detail: portal.url ? `portal session ok` : "missing portal url",
    });
  } catch (err) {
    results.push({
      name: "customer portal (cancel)",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  console.log("\n=== Stripe TEST results ===");
  for (const row of results) {
    console.log(`${row.ok ? "PASS" : "FAIL"}  ${row.name} — ${row.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[stripe-test] failed", err);
  process.exit(1);
});
