"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { captureAttribution } from "@/lib/attribution";

/** Remember first-touch utm params so a later signup still has them. */
export function AttributionCapture() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    captureAttribution(query ? `?${query}` : "");
  }, [searchParams]);

  return null;
}
