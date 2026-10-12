"use client";

import { useEffect } from "react";
import { trackFunnel } from "@/lib/funnel";

export function LandingView() {
  useEffect(() => {
    trackFunnel("landing_view", { plan: "free" }, {
      scope: "session",
      key: "landing_view",
    });
  }, []);
  return null;
}
