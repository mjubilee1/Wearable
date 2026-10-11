"use client";

import { useAuth } from "@/lib/auth-context";
import { MarketingAccountLink } from "@/components/MarketingAccountLink";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#day", label: "The day" },
  { href: "#refuse", label: "What we refuse" },
] as const;

export function MarketingNav() {
  const { loading, user } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-teal/10 bg-white/85 text-ink backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-6">
        <a
          href="#top"
          className="text-[1.65rem] font-extrabold leading-none tracking-[-0.05em] text-teal"
        >
          nearby
        </a>
        <nav className="hidden items-center gap-8 text-sm text-muted md:flex">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} className="hover:text-ink">
              {link.label}
            </a>
          ))}
        </nav>
        {loading ? (
          <span className="h-9 w-28" aria-hidden />
        ) : user ? (
          <MarketingAccountLink
            className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white"
            signedInLabel="Open the app"
          />
        ) : (
          <a
            href="#waitlist"
            className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Get updates
          </a>
        )}
      </div>
    </header>
  );
}
