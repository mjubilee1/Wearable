"use client";

import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth-context";
import { useSignupHref } from "@/lib/use-signup-href";

export function MarketingNav({
  signupHref,
  pricingHref = "/pricing",
  messagesHref = "/#messages",
  tone = "solid",
}: {
  signupHref?: string;
  pricingHref?: string;
  messagesHref?: string;
  tone?: "solid" | "overlay";
}) {
  const { user, loading } = useAuth();
  const storedHref = useSignupHref();
  const accountHref =
    signupHref && signupHref !== "/signup" ? signupHref : storedHref;
  const signedIn = !loading && Boolean(user);
  const overlay = tone === "overlay";

  return (
    <header
      className={
        overlay
          ? "absolute inset-x-0 top-0 z-50 text-ink"
          : "sticky top-0 z-50 border-b border-ink/15 bg-paper text-ink"
      }
    >
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5">
        <div className="flex items-baseline gap-8">
          {overlay ? (
            <span className="sr-only">Nearby Hello</span>
          ) : (
            <BrandMark className="font-display text-2xl italic leading-none text-ink" />
          )}
          <nav
            className={`hidden items-center gap-6 text-sm md:flex ${
              overlay ? "text-ink/70" : "text-muted"
            }`}
          >
            <Link href={messagesHref} className="hover:text-ink">
              The story
            </Link>
            <Link href={pricingHref} className="hover:text-ink">
              Your privacy
            </Link>
          </nav>
        </div>
        <div className="flex h-9 min-w-36 items-center justify-end gap-5">
          {signedIn ? (
            <Link
              href="/nearby"
              className="bg-ink px-3 py-2 text-sm font-semibold text-white"
            >
              Open Nearby Hello
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className={`text-sm hover:text-ink ${
                  overlay ? "text-ink/70" : "text-muted"
                }`}
              >
                Sign in
              </Link>
              <Link
                href={accountHref}
                className="bg-ink px-3 py-2 text-sm font-semibold text-white"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
