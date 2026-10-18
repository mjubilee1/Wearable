"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { readFirstTouch } from "@/lib/attribution";

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID;
/** Google Ads tag. Public sitewide ID, same snippet Google gives in Ads. */
const GOOGLE_ADS_ID =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_ID ?? "AW-18507934375";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function GoogleAnalyticsPageViews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstView = useRef(true);

  useEffect(() => {
    if (typeof window.gtag !== "function") return;

    // The initial gtag config already sends the first page view.
    if (isFirstView.current) {
      isFirstView.current = false;
      return;
    }

    const query = new URLSearchParams(searchParams.toString());
    if (pathname === "/signup") {
      const touch = readFirstTouch();
      if (!query.get("utm_source") && touch.utm_source) {
        query.set("utm_source", touch.utm_source);
      }
      if (!query.get("utm_medium") && touch.utm_medium) {
        query.set("utm_medium", touch.utm_medium);
      }
      if (!query.get("utm_campaign") && touch.utm_campaign) {
        query.set("utm_campaign", touch.utm_campaign);
      }
    }
    const nextQuery = query.toString();
    const page_path = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    if (GA_MEASUREMENT_ID) {
      window.gtag("config", GA_MEASUREMENT_ID, { page_path });
    }
    window.gtag("config", GOOGLE_ADS_ID, { page_path });
  }, [pathname, searchParams]);

  return null;
}

export function GoogleAnalytics() {
  const loaderId = GA_MEASUREMENT_ID || GOOGLE_ADS_ID;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${loaderId}`}
        strategy="lazyOnload"
      />
      <Script id="google-analytics" strategy="lazyOnload">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          ${GA_MEASUREMENT_ID ? `gtag('config', '${GA_MEASUREMENT_ID}');` : ""}
          gtag('config', '${GOOGLE_ADS_ID}');
        `}
      </Script>
      <Suspense fallback={null}>
        <GoogleAnalyticsPageViews />
      </Suspense>
    </>
  );
}
