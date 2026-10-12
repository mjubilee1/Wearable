"use client";

const PROMO_KEY = "nearby_promo";
const REFERRAL_KEY = "nearby_referral";
const FOUNDING_PROMO = "FOUNDING19";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function captureOfferParams(params: URLSearchParams): void {
  const promo = params.get("promo")?.trim().toUpperCase();
  if (promo === FOUNDING_PROMO) storage()?.setItem(PROMO_KEY, promo);

  const referral = params.get("ref")?.trim().toUpperCase();
  if (referral && /^[A-Z0-9]{6,16}$/.test(referral)) {
    storage()?.setItem(REFERRAL_KEY, referral);
  }
}

export function storedPromoCode(): string | null {
  return storage()?.getItem(PROMO_KEY) === FOUNDING_PROMO
    ? FOUNDING_PROMO
    : null;
}

export function storedReferralCode(): string | null {
  const value = storage()?.getItem(REFERRAL_KEY)?.trim().toUpperCase();
  return value && /^[A-Z0-9]{6,16}$/.test(value) ? value : null;
}

export function hasFoundingOffer(params?: URLSearchParams): boolean {
  return (
    params?.get("promo")?.trim().toUpperCase() === FOUNDING_PROMO ||
    storedPromoCode() === FOUNDING_PROMO
  );
}
