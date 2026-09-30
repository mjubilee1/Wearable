"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const PUBLIC_PATHS = new Set(["/login", "/signup", "/forgot-password"]);

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) {
      router.replace("/login");
      return;
    }
    if (user && isPublic) {
      router.replace("/");
    }
  }, [user, loading, isPublic, router]);

  if (loading) {
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
  if (user && isPublic) return null;

  return <>{children}</>;
}
