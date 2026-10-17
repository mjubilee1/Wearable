"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clientNeedsEmailVerification, INVITE_STORAGE_KEY, inviteCodeFromPath } from "@nearby/shared";
import { acceptInvite } from "@/lib/phone-messaging";
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
  const { user, profile, loading, emailVerified } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isMarketing = pathname === "/" || pathname === "/pricing";
  const isAuthScreen = AUTH_PATHS.has(pathname);
  const isInvite = pathname.startsWith("/invite/");
  const isPublic = isMarketing || isAuthScreen || isInvite;
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
    const code = inviteCodeFromPath(pathname);
    if (!code) return;
    try {
      sessionStorage.setItem(INVITE_STORAGE_KEY, code);
    } catch {
      // The invite page stores it again when it can render.
    }
  }, [pathname]);

  useEffect(() => {
    if (!user) return;
    let code = "";
    try {
      code = sessionStorage.getItem(INVITE_STORAGE_KEY) ?? "";
    } catch {
      return;
    }
    if (!code) return;
    let cancelled = false;
    void user.getIdToken().then((token) => acceptInvite(token, code)).then(() => {
      if (cancelled) return;
      try {
        sessionStorage.removeItem(INVITE_STORAGE_KEY);
      } catch {
        // Already connected.
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) {
      router.replace("/login");
      return;
    }
    if (user && isAuthScreen && !needsEmail) {
      router.replace(afterAuthPath());
      return;
    }
    if (
      user &&
      !needsEmail &&
      profile?.phoneOnboardingRequired &&
      pathname !== "/onboarding" &&
      !isInvite
    ) {
      router.replace("/onboarding");
      return;
    }
    if (user && !needsEmail && pathname === "/" && !profile?.phoneOnboardingRequired) {
      router.replace("/activity");
    }
  }, [user, profile, loading, isPublic, isAuthScreen, isInvite, needsEmail, pathname, router]);

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
  if (user && needsEmail && (!isMarketing || pathname === "/")) return <VerifyEmailScreen />;
  if (user && isAuthScreen) return null;
  if (user && pathname === "/") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pt-20 sm:px-8">
        <div className="h-3 w-16 animate-pulse rounded bg-teal/20" />
        <div className="mt-3 h-9 w-40 animate-pulse rounded-lg bg-surface" />
      </div>
    );
  }

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
