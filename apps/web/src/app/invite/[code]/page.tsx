"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { INVITE_STORAGE_KEY, isInviteCode } from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";
import { acceptInvite } from "@/lib/phone-messaging";

export default function InvitePage() {
  const params = useParams<{ code: string }>();
  const code = typeof params.code === "string" ? params.code : "";
  const valid = isInviteCode(code);
  const { user } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<"ready" | "joining" | "joined" | "error">(
    valid ? "ready" : "error",
  );
  const [error, setError] = useState<string | null>(
    valid ? null : "That invite link is not valid.",
  );

  useEffect(() => {
    if (!valid) return;
    try {
      sessionStorage.setItem(INVITE_STORAGE_KEY, code);
    } catch {
      // Accept still runs on this page when they are signed in.
    }
  }, [code, valid]);

  useEffect(() => {
    if (!valid || !user) return;
    let cancelled = false;
    setStatus("joining");
    void user
      .getIdToken()
      .then((token) => acceptInvite(token, code))
      .then(() => {
        if (cancelled) return;
        try {
          sessionStorage.removeItem(INVITE_STORAGE_KEY);
        } catch {
          // The connection is already saved.
        }
        setStatus("joined");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Could not accept that invite");
      });
    return () => {
      cancelled = true;
    };
  }, [code, user, valid]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <p className="font-display text-3xl italic text-ink">nearby</p>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-ink">
        {status === "joined"
          ? "You're connected"
          : valid
            ? "You've been invited to Nearby"
            : "That invite link is not valid"}
      </h1>
      {valid ? (
        <p className="mt-2 text-sm text-muted">
          {status === "joined"
            ? "You can message them in Nearby. The conversation stays in the app."
            : "Create an account to message them. The conversation stays in Nearby."}
        </p>
      ) : null}
      {valid && error ? (
        <p className="mt-4 rounded-2xl bg-coral-soft px-3 py-2 text-sm text-coral">{error}</p>
      ) : null}
      <div className="mt-8">
        {status === "joined" ? (
          <button
            type="button"
            onClick={() => router.push("/messages")}
            className="w-full rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-white"
          >
            Open messages
          </button>
        ) : !valid ? null : user ? (
          <p className="text-sm text-muted">{status === "joining" ? "Connecting…" : ""}</p>
        ) : (
          <Link
            href="/signup"
            className="block w-full rounded-2xl bg-teal px-4 py-3 text-center text-sm font-semibold text-white"
          >
            Create an account
          </Link>
        )}
      </div>
    </div>
  );
}
