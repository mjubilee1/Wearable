"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ConnectorSetupPrompt } from "@/components/ConnectorSetupPrompt";
import { useAuth } from "@/lib/auth-context";

const AUTH_PATHS = new Set(["/login", "/signup", "/forgot-password"]);

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isMarketing = pathname === "/";
  const isAuthScreen = AUTH_PATHS.has(pathname);
  const isPublic = isMarketing || isAuthScreen;

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) {
      router.replace("/login");
      return;
    }
    if (user && isAuthScreen) {
      router.replace("/activity");
    }
  }, [user, loading, isPublic, isAuthScreen, router]);

  if (loading && !isPublic) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-pulse rounded-full bg-teal" />
          <p className="mt-3 text-sm text-muted">Connecting…</p>
        </div>
      </div>
    );
  }

  if (!user && !isPublic) return null;
  if (user && isAuthScreen) return null;

  return (
    <>
      {children}
      {user && !isPublic ? <ConnectorSetupPrompt /> : null}
    </>
  );
}
