import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import {
  createCheckoutSession,
  createPortalSession,
  setStripeClientForTest,
} from "./billing.js";

test("monthly, annual, founding promo, and portal use the existing Stripe catalog", async () => {
  const checkoutParams: Stripe.Checkout.SessionCreateParams[] = [];
  const priceQueries: Stripe.PriceListParams[] = [];
  const portalParams: Stripe.BillingPortal.SessionCreateParams[] = [];

  const stripe = {
    customers: {
      create: async () => ({ id: "cus_existing" }),
    },
    prices: {
      list: async (params: Stripe.PriceListParams) => {
        priceQueries.push(params);
        if (params.lookup_keys?.includes("pro_monthly")) {
          return {
            data: [
              {
                id: "price_monthly",
                recurring: { interval: "month" },
                currency: "usd",
                unit_amount: 2900,
              },
            ],
          };
        }
        if (params.lookup_keys?.includes("pro_annual")) return { data: [] };
        return {
          data: [
            {
              id: "price_annual_249",
              recurring: { interval: "year" },
              currency: "usd",
              unit_amount: 24900,
            },
          ],
        };
      },
    },
    products: {
      list: async () => ({ data: [{ id: "prod_pro", name: "Pro" }] }),
    },
    promotionCodes: {
      list: async () => ({
        data: [{ id: "promo_founding", code: "FOUNDING19" }],
      }),
    },
    checkout: {
      sessions: {
        create: async (params: Stripe.Checkout.SessionCreateParams) => {
          checkoutParams.push(params);
          return { url: "https://checkout.stripe.test/session" };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (params: Stripe.BillingPortal.SessionCreateParams) => {
          portalParams.push(params);
          return { url: "https://billing.stripe.test/portal" };
        },
      },
    },
  } as unknown as Stripe;

  setStripeClientForTest(stripe);
  try {
    await createCheckoutSession({ uid: "monthly", interval: "month" });
    await createCheckoutSession({ uid: "annual", interval: "year" });
    await createCheckoutSession({
      uid: "founding",
      interval: "month",
      promoCode: "FOUNDING19",
    });
    await createPortalSession({ stripeCustomerId: "cus_existing" });
  } finally {
    setStripeClientForTest(null);
  }

  assert.equal(checkoutParams[0].mode, "subscription");
  assert.equal(checkoutParams[0].payment_method_collection, "always");
  assert.equal(checkoutParams[0].subscription_data?.trial_period_days, 7);
  assert.equal(checkoutParams[0].line_items?.[0]?.price, "price_monthly");
  assert.equal(checkoutParams[0].allow_promotion_codes, true);
  assert.equal(checkoutParams[0].discounts, undefined);

  assert.equal(checkoutParams[1].line_items?.[0]?.price, "price_annual_249");
  assert.ok(
    priceQueries.some((query) => query.lookup_keys?.includes("pro_annual")),
  );
  assert.ok(priceQueries.some((query) => query.product === "prod_pro"));

  assert.equal(checkoutParams[2].allow_promotion_codes, undefined);
  assert.deepEqual(checkoutParams[2].discounts, [
    { promotion_code: "promo_founding" },
  ]);
  assert.equal(
    checkoutParams[2].subscription_data?.metadata?.promoCode,
    "FOUNDING19",
  );

  assert.deepEqual(portalParams, [
    {
      customer: "cus_existing",
      return_url: "http://localhost:3000/profile",
    },
  ]);
});
