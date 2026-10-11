"use client";

import { useAuth } from "@/lib/auth-context";
import { MarketingAccountLink } from "@/components/MarketingAccountLink";

export function MarketingNav() {
  const { loading } = useAuth();

  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
      <a href="#top" className="text-sm font-bold tracking-tight text-ink">
        Nearby
      </a>
      {loading ? (
        <span className="h-9 w-20" aria-hidden />
      ) : (
        <MarketingAccountLink className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white" />
      )}
    </header>
  );
}
