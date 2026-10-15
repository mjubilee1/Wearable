"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clientNeedsEmailVerification } from "@nearby/shared";
import { ConnectorSetupPrompt } from "@/components/ConnectorSetupPrompt";
import { TrialBanner } from "@/components/TrialBanner";
import { VerifyEmailScreen } from "@/components/VerifyEmailScreen";
import { useAuth } from "@/lib/auth-context";

const AUTH_PATHS = new Set(["/login", "/signup", "/forgot-password"]);
const ONBOARDING_FLAG = "nearby_onboarding";

function afterAuthPath(): string {
  try {
    if (sessionStorage.getItem(ONBOARDING_FLAG) === "1") return "/onboarding";
  } catch {
    // Fall through to Talk.
  }
  return "/activity";
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, emailVerified } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isMarketing = pathname === "/" || pathname === "/pricing";
  const isAuthScreen = AUTH_PATHS.has(pathname);
  const isPublic = isMarketing || isAuthScreen;
  const createdAtMs = user
    ? Date.parse(user.metadata.creationTime ?? "") || 0
    : 0;
  const needsEmail = user
    ? clientNeedsEmailVerification({
        emailVerified,
        providerIds: user.providerData.map((provider) => provider.providerId),
        createdAtMs,
      })
    : false;

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) {
      router.replace("/login");
      return;
    }
    if (user && isAuthScreen && !needsEmail) {
      router.replace(afterAuthPath());
    }
  }, [user, loading, isPublic, isAuthScreen, needsEmail, router]);

  if (loading && !isPublic) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pt-20 sm:px-8">
        <div className="fixed inset-x-0 top-0 z-40 h-[52px] border-b border-black/5 bg-white/80" />
        <div className="h-3 w-16 animate-pulse rounded bg-teal/20" />
        <div className="mt-3 h-9 w-40 animate-pulse rounded-lg bg-surface" />
        <div className="mt-6 h-36 animate-pulse rounded-3xl bg-card shadow-sm" />
        <div className="mt-4 h-28 animate-pulse rounded-3xl bg-card shadow-sm" />
      </div>
    );
  }

  if (!user && !isPublic) return null;
  if (user && needsEmail && !isMarketing) return <VerifyEmailScreen />;
  if (user && isAuthScreen) return null;

  return (
    <>
      <Suspense fallback={null}>
        <TrialBanner />
      </Suspense>
      {children}
      {user && !isPublic && pathname !== "/onboarding" ? (
        <ConnectorSetupPrompt />
      ) : null}
    </>
  );
}
