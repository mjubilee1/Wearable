"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

export function MarketingAccountLink({
  className,
  signedInLabel = "Open app",
  signedOutLabel = "Sign in",
}: {
  className?: string;
  signedInLabel?: string;
  signedOutLabel?: string;
}) {
  const { user, loading } = useAuth();
  const href = !loading && user ? "/nearby" : "/login";
  const label = !loading && user ? signedInLabel : signedOutLabel;

  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}
