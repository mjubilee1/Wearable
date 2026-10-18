"use client";

import { useEffect, useState } from "react";
import { readFirstTouch, signupHref } from "@/lib/attribution";

/**
 * Signup link with utm_source / utm_campaign.
 * Starts as /signup so server HTML matches, then picks up the URL or first touch.
 */
export function useSignupHref(): string {
  const [href, setHref] = useState("/signup");

  useEffect(() => {
    const fromUrl = signupHref(new URLSearchParams(window.location.search));
    if (fromUrl !== "/signup") {
      setHref(fromUrl);
      return;
    }
    const touch = readFirstTouch();
    const stored = new URLSearchParams();
    if (touch.utm_source) stored.set("utm_source", touch.utm_source);
    if (touch.utm_medium) stored.set("utm_medium", touch.utm_medium);
    if (touch.utm_campaign) stored.set("utm_campaign", touch.utm_campaign);
    setHref(signupHref(stored));
  }, []);

  return href;
}
