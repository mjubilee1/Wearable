"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { captureAttribution } from "@/lib/attribution";
import { capturePromo } from "@/lib/promo";

/** Remember first-touch utm params and ?promo= for checkout. */
export function AttributionCapture() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    const search = query ? `?${query}` : "";
    captureAttribution(search);
    capturePromo(search);
  }, [searchParams]);

  return null;
}
