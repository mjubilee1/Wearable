"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { captureReferral } from "@/lib/referral";

/** Landing for /r/<code> — stores the referral and sends people to signup. */
export default function ReferralLandingPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();

  useEffect(() => {
    const code = typeof params.code === "string" ? params.code : "";
    captureReferral(code);
    router.replace("/signup");
  }, [params.code, router]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-5">
      <p className="text-sm text-muted">Opening Nearby…</p>
    </div>
  );
}
