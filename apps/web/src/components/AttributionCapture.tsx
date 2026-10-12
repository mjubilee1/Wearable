"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { captureUtmSource } from "@/lib/attribution";

/** Remember ?utm_source= for this tab so a later waitlist submit still has it. */
export function AttributionCapture() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    captureUtmSource(query ? `?${query}` : "");
  }, [searchParams]);

  return null;
}
