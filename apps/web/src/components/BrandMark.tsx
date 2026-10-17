"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

export function BrandMark({ className }: { className?: string }) {
  const { user, loading } = useAuth();
  const href = !loading && user ? "/activity" : "/";

  return (
    <Link href={href} className={className}>
      nearby
    </Link>
  );
}
