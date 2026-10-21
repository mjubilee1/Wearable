"use client";

import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth-context";
import { useSignupHref } from "@/lib/use-signup-href";

export function MarketingNav({
  signupHref,
  pricingHref = "/pricing",
  messagesHref = "/#messages",
}: {
  signupHref?: string;
  pricingHref?: string;
  messagesHref?: string;
}) {
  const { user, loading } = useAuth();
  const storedHref = useSignupHref();
  const accountHref =
    signupHref && signupHref !== "/signup" ? signupHref : storedHref;
  const signedIn = !loading && Boolean(user);

  return (
    <header className="sticky top-0 z-50 border-b border-ink/15 bg-paper text-ink">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5">
        <div className="flex items-baseline gap-8">
          <BrandMark className="font-display text-2xl italic leading-none text-ink" />
          <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
            <Link href={messagesHref} className="hover:text-ink">
              How it works
            </Link>
            <Link href={pricingHref} className="hover:text-ink">
              Privacy
            </Link>
          </nav>
        </div>
        <div className="flex h-9 min-w-36 items-center justify-end gap-5">
          {signedIn ? (
            <Link href="/nearby" className="bg-ink px-3 py-2 text-sm font-semibold text-white">
              Open Nearby Hello
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-sm text-muted hover:text-ink">
                Sign in
              </Link>
              <Link href={accountHref} className="bg-ink px-3 py-2 text-sm font-semibold text-white">
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
