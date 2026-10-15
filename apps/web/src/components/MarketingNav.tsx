"use client";

import { useAuth } from "@/lib/auth-context";
import { MarketingAccountLink } from "@/components/MarketingAccountLink";

const LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "#pricing", label: "Plans" },
] as const;

export function MarketingNav() {
  const { loading, user } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-ink/15 bg-paper text-ink">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5">
        <div className="flex items-baseline gap-8">
          <a href="/" className="font-display text-2xl italic leading-none text-ink">
            nearby
          </a>
          <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} className="hover:text-ink">
                {link.label}
              </a>
            ))}
          </nav>
        </div>
        {loading ? (
          <span className="h-9 w-28" aria-hidden />
        ) : user ? (
          <MarketingAccountLink
            className="bg-ink px-3 py-2 text-sm font-semibold text-white"
            signedInLabel="Open the app"
          />
        ) : (
          <div className="flex items-center gap-5">
            <a href="/login" className="text-sm text-muted hover:text-ink">
              Sign in
            </a>
            <a href="/signup" className="bg-ink px-3 py-2 text-sm font-semibold text-white">
              Sign up
            </a>
          </div>
        )}
      </div>
    </header>
  );
}
