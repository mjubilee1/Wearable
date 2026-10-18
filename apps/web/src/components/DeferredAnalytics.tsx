"use client";

import dynamic from "next/dynamic";

const Analytics = dynamic(
  () => import("@vercel/analytics/next").then((mod) => mod.Analytics),
  { ssr: false },
);

/** Loads Vercel Analytics after hydration so it stays off the first paint. */
export function DeferredAnalytics() {
  return <Analytics />;
}
